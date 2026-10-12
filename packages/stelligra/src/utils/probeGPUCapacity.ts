/**
 *
 * Probes the GPU to determine the maximum safe splat texture capacity.
 * Results are cached in localStorage with per-step logging so that if
 * a probe causes a crash, on reload we can infer where it failed and
 * skip past it — preventing crash loops on low-memory devices.
 *
 * localStorage key: "stelligra-gpu-probe-v1"
 *
 * Stored state example:
 * {
 *   maxTexSize: 8192,
 *   steps: {
 *     "1000000":  "pass",
 *     "2000000":  "pass",
 *     "5000000":  "started",   ← crashed here, will skip next time
 *     "10000000": "skip"
 *   },
 *   result: 2000000,           ← best confirmed passing value
 *   complete: false            ← probe didn't finish cleanly
 * }
 */

import * as THREE from "three"

const PROBE_KEY = "stelligra-gpu-probe-v1"

// Candidates in ascending order — important for crash detection
const PROBE_CANDIDATES = [1_000_000, 2_000_000, 5_000_000, 10_000_000]

const FALLBACK_CAPACITY = 500_000

type StepStatus = "pass" | "fail" | "started" | "skip"

interface ProbeState {
  maxTexSize: number
  steps: Record<string, StepStatus>
  result: number
  complete: boolean
  timestamp: number
}

function loadState(): ProbeState | null {
  try {
    const raw = localStorage.getItem(PROBE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ProbeState
  } catch {
    return null
  }
}

function saveState(state: ProbeState): void {
  try {
    localStorage.setItem(PROBE_KEY, JSON.stringify(state))
  } catch {}
}

function markStep(
  state: ProbeState,
  capacity: number,
  status: StepStatus
): void {
  state.steps[String(capacity)] = status
  saveState(state)
}

export async function probeGPUCapacity(
  renderer: THREE.WebGLRenderer
): Promise<number> {
  const gl = renderer.getContext() as WebGL2RenderingContext
  const maxTexSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number

  const existing = loadState()

  // If we have a complete probe for this same device tier, use cached result
  if (
    existing?.complete &&
    existing.maxTexSize === maxTexSize &&
    typeof existing.result === "number"
  ) {
    console.log(
      `[GPU Probe] Using cached result: ${existing.result.toLocaleString()} splats`,
      existing.steps
    )
    return existing.result
  }

  // Start fresh state or recover from a previous incomplete/crashed probe
  const state: ProbeState = {
    maxTexSize,
    steps: existing?.maxTexSize === maxTexSize ? { ...existing.steps } : {},
    result:
      existing?.maxTexSize === maxTexSize
        ? existing.result ?? FALLBACK_CAPACITY
        : FALLBACK_CAPACITY,
    complete: false,
    timestamp: Date.now(),
  }

  // If a previous run left a "started" entry, that candidate caused a crash.
  // Mark it as "fail" and skip it this run.
  for (const [key, status] of Object.entries(state.steps)) {
    if (status === "started") {
      console.warn(
        `[GPU Probe] Candidate ${Number(
          key
        ).toLocaleString()} caused a crash last run — skipping`
      )
      state.steps[key] = "fail"
    }
  }
  saveState(state)

  console.log(`[GPU Probe] Starting probe (maxTexSize=${maxTexSize})...`)

  for (const capacity of PROBE_CANDIDATES) {
    const key = String(capacity)
    const existingStatus = state.steps[key]

    // Skip already-tested or previously crashed candidates
    if (
      existingStatus === "pass" ||
      existingStatus === "fail" ||
      existingStatus === "skip"
    ) {
      console.log(
        `[GPU Probe] ${capacity.toLocaleString()} splats: ${existingStatus} (cached)`
      )
      if (existingStatus === "pass") state.result = capacity
      continue
    }

    const covRows = Math.ceil((capacity * 2) / 2048) // 2 texels per splat
    if (covRows > maxTexSize) {
      console.log(
        `${capacity.toLocaleString()} splats: skip (cov texture ${covRows} rows exceeds maxTexSize ${maxTexSize})`
      )
      markStep(state, capacity, "skip")
      continue
    }

    // Mark as started BEFORE the allocation — if this crashes, next reload
    // will see "started" and know this size caused the crash
    markStep(state, capacity, "started")
    console.log(`[GPU Probe] ${capacity.toLocaleString()} splats: testing...`)

    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      2048,
      covRows,
      0,
      gl.RGBA,
      gl.FLOAT,
      null
    )
    const err = gl.getError()
    gl.deleteTexture(tex)
    gl.bindTexture(gl.TEXTURE_2D, null)

    if (err === gl.NO_ERROR) {
      console.log(`[GPU Probe] ${capacity.toLocaleString()} splats: pass`)
      state.result = capacity
      markStep(state, capacity, "pass")
    } else {
      console.log(
        `[GPU Probe] ${capacity.toLocaleString()} splats: fail (GL error ${err})`
      )
      markStep(state, capacity, "fail")
      // Stop probing — further sizes will also fail
      for (const remaining of PROBE_CANDIDATES) {
        if (remaining > capacity) {
          markStep(state, remaining, "skip")
        }
      }
      break
    }
  }

  state.complete = true
  saveState(state)

  console.log(
    `[GPU Probe] Complete. Result: ${state.result.toLocaleString()} splats`,
    state.steps
  )

  return state.result
}

/**
 * Clear the cached probe result — call this if you want to force a re-probe,
 * e.g. after a major GPU driver update or when debugging.
 */
export function clearGPUProbeCache(): void {
  try {
    localStorage.removeItem(PROBE_KEY)
  } catch {}
}
