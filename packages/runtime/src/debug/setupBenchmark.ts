import * as THREE from "three"
import { Catalyst } from "@vitrine/catalyst"
import { muteDebug } from "../utils"
import type ManagerRegistry from "../managers/ManagerRegistry"
import type { SplatRendererStats } from "@vitrine/stelligra"
import type { VolumetricGaussianSplat } from "@vitrine/catalyst"

export type ScenarioName = "guided" | "idle" | "look"

export interface RunOptions {
  label?: string
  frames?: number
  warmup?: boolean
  uncapped?: boolean
  repeat?: number
  pixelRatio?: number
}

interface Distribution {
  mean: number
  p50: number
  p95: number
  max: number
}

export interface BenchmarkResult {
  label: string
  scenario: ScenarioName
  timestamp: string
  frames: number
  durationMs: number
  fps: number
  cpuFrameMs: Distribution
  desiredStateMs: Distribution
  updateRendererMs: Distribution
  renderCpuMs: Distribution
  gpuMs: Distribution | null
  sorts: {
    dispatched: number
    completed: number
    perSecond: number
    meanMs: number
    maxMs: number
  }
  uploads: { batches: number; splats: number; mb: number; ms: number }
  visibleSplats: number
  streamingFrames: number
  heapMb: number | null
  runs: number
  spread: {
    cpuP95: [number, number]
    gpuP50: [number, number] | null
  }
}

type RunResult = Omit<BenchmarkResult, "runs" | "spread">

interface LoadTimeline {
  vgsReadyMs: number | null
  streamingIdleMs: number | null
}

interface FrameSample {
  cpu: number
  desiredState: number
  updateRenderer: number
  renderCpu: number
  streaming: boolean
}

interface Scenario {
  frames: number
  start(): void
  step(frame: number, total: number): void
  end(): void
}

const STORAGE_KEY = "bve-bench-results"
const SPLAT_BYTES = 32
const FIRST = 1e6
const LAST = -1e6

const distribution = (values: number[]): Distribution => {
  if (values.length === 0) return { mean: 0, p50: 0, p95: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return {
    mean: values.reduce((sum, v) => sum + v, 0) / values.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted[sorted.length - 1],
  }
}

const round = (value: number, places = 2) =>
  Math.round(value * 10 ** places) / 10 ** places

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const range = (values: number[]): [number, number] => [
  Math.min(...values),
  Math.max(...values),
]

const medianOfRuns = <T>(items: T[]): T => {
  const first = items[0]
  if (items.some((item) => item === null)) return null as T
  if (typeof first === "number") return round(median(items as number[])) as T
  if (typeof first !== "object" || Array.isArray(first)) return first
  return Object.fromEntries(
    Object.keys(first as object).map((key) => [
      key,
      medianOfRuns(items.map((item) => (item as Record<string, unknown>)[key])),
    ]),
  ) as T
}

const roundDistribution = (d: Distribution): Distribution => ({
  mean: round(d.mean),
  p50: round(d.p50),
  p95: round(d.p95),
  max: round(d.max),
})

const nextFrame = () => new Promise((r) => requestAnimationFrame(r))

const loadStoredResults = (): BenchmarkResult[] => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")
  } catch {
    return []
  }
}

const storeResults = (results: BenchmarkResult[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(results))
  } catch {
    return
  }
}

class GpuTimer {
  private _gl: WebGL2RenderingContext
  private _ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  private _pending: WebGLQuery[] = []
  private _active: WebGLQuery | null = null
  public results: number[] = []

  constructor(gl: WebGL2RenderingContext) {
    this._gl = gl
    this._ext = gl.getExtension("EXT_disjoint_timer_query_webgl2")
  }

  public get supported(): boolean {
    return this._ext !== null
  }

  public begin(): void {
    if (!this._ext || this._active) return
    const query = this._gl.createQuery()
    if (!query) return
    this._gl.beginQuery(this._ext.TIME_ELAPSED_EXT, query)
    this._active = query
  }

  public end(): void {
    if (!this._ext || !this._active) return
    this._gl.endQuery(this._ext.TIME_ELAPSED_EXT)
    this._pending.push(this._active)
    this._active = null
  }

  public poll(): void {
    if (!this._ext) return
    const gl = this._gl
    const disjoint = gl.getParameter(this._ext.GPU_DISJOINT_EXT)

    this._pending = this._pending.filter((query) => {
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return true
      if (!disjoint) {
        this.results.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6)
      }
      gl.deleteQuery(query)
      return false
    })
  }

  public get hasPending(): boolean {
    return this._pending.length > 0
  }
}

class Benchmark {
  private _managers: ManagerRegistry
  public results: BenchmarkResult[] = loadStoredResults()
  public load: LoadTimeline = { vgsReadyMs: null, streamingIdleMs: null }

  constructor(managers: ManagerRegistry) {
    this._managers = managers
    this.trackLoad()
  }

  private get vgs(): VolumetricGaussianSplat {
    const vgs = this._managers.scene.volumetricSplat
    if (!vgs || !this._managers.scene.isVgsReady)
      throw new Error("[bench] Scene is not ready yet")
    return vgs
  }

  private trackLoad(): void {
    let idleSince: number | null = null

    const poll = () => {
      const scene = this._managers.scene
      const vgs = scene.volumetricSplat
      const now = performance.now()

      if (this.load.vgsReadyMs === null && scene.isVgsReady)
        this.load.vgsReadyMs = round(now, 0)

      if (this.load.vgsReadyMs !== null && vgs) {
        if (vgs.isStreaming) idleSince = null
        else idleSince ??= now

        if (idleSince !== null && now - idleSince > 1000) {
          this.load.streamingIdleMs = round(idleSince, 0)
          console.log("[bench] load", this.load)
          return
        }
      }

      setTimeout(poll, 100)
    }

    poll()
  }

  public async waitForIdle(timeoutMs = 60_000): Promise<void> {
    const start = performance.now()
    let idleFrames = 0
    while (idleFrames < 30) {
      if (performance.now() - start > timeoutMs) {
        console.warn("[bench] Streaming did not settle, measuring anyway")
        return
      }
      idleFrames = this.vgs.isStreaming ? 0 : idleFrames + 1
      await nextFrame()
    }
  }

  private setGuided(guided: boolean): void {
    const scene = this._managers.scene
    if (this._managers.state.isGuidedCamera !== guided) scene.toggleCamera()
  }

  private scenario(name: ScenarioName, frames?: number): Scenario {
    const scene = this._managers.scene

    if (name === "guided") {
      return {
        frames: frames ?? 600,
        start: () => this.setGuided(true),
        step: (frame, total) =>
          scene.jumpToPathProgress(frame / Math.max(1, total - 1)),
        end: () => {},
      }
    }

    if (name === "idle") {
      return {
        frames: frames ?? 300,
        start: () => {
          this.setGuided(true)
          scene.jumpToPathProgress(0.5)
        },
        step: () => {},
        end: () => {},
      }
    }

    const camera = scene.controller?.camera
    const startRotation = camera?.transform.rotation
    const yaw = new THREE.Quaternion()
    const up = new THREE.Vector3(0, 1, 0)
    const setRotation = (rotation: THREE.Quaternion) => {
      if (!camera) return
      camera.transform.rotation = rotation
      camera.view.quaternion.copy(rotation)
    }

    return {
      frames: frames ?? 300,
      start: () => this.setGuided(false),
      step: (frame, total) => {
        if (!startRotation) return
        yaw.setFromAxisAngle(up, (frame / total) * Math.PI * 2)
        setRotation(startRotation.clone().multiply(yaw))
      },
      end: () => {
        if (startRotation) setRotation(startRotation)
        this.setGuided(true)
      },
    }
  }

  private async measure(
    name: ScenarioName,
    options: RunOptions,
  ): Promise<RunResult> {
    const vgs = this.vgs
    const renderer = Catalyst._.renderer
    if (!renderer) throw new Error("[bench] Renderer is disabled")
    if (document.hidden)
      throw new Error("[bench] Tab is hidden, bring it to the foreground")

    const scenario = this.scenario(name, options.frames)
    const signals = Catalyst._.signals
    const gpu = new GpuTimer(renderer.getContext() as WebGL2RenderingContext)
    const samples: FrameSample[] = []

    let frameStart = 0
    let renderStart = 0
    let renderEnd = 0
    let desiredState = 0
    let updateRenderer = 0

    const computeDesiredState = vgs.computeDesiredState
    const reconcile = vgs.reconcile
    const updateRendererFn = vgs.updateRenderer
    const timed =
      <A extends unknown[], R>(
        fn: (...args: A) => R,
        add: (ms: number) => void,
      ) =>
      (...args: A): R => {
        const t0 = performance.now()
        const result = fn.apply(vgs, args)
        add(performance.now() - t0)
        return result
      }

    vgs.computeDesiredState = timed(computeDesiredState, (ms) => {
      desiredState += ms
    })
    vgs.reconcile = timed(reconcile, (ms) => (desiredState += ms))
    vgs.updateRenderer = timed(updateRendererFn, (ms) => {
      updateRenderer += ms
    })

    const statsBefore: SplatRendererStats = { ...vgs.splatRenderer.stats }
    muteDebug(true)
    const previousFps = Catalyst._.targetFPS
    if (options.uncapped !== false) Catalyst._.targetFPS = null
    const previousResolution = Catalyst._.resolution
    Catalyst._.resolution = {
      mode: "fixed",
      pixelRatio: options.pixelRatio ?? 1,
    }

    scenario.start()
    let frame = 0
    let resolveDone: () => void = () => {}
    const done = new Promise<void>((r) => (resolveDone = r))

    const onUpdate = () => {
      frameStart = performance.now()
      desiredState = 0
      updateRenderer = 0
      scenario.step(frame, scenario.frames)
    }
    const onRender = () => {
      renderStart = performance.now()
      gpu.begin()
    }
    const onRendered = () => {
      gpu.end()
      renderEnd = performance.now()
    }
    const onFrameEnd = () => {
      gpu.poll()
      samples.push({
        cpu: performance.now() - frameStart,
        desiredState,
        updateRenderer,
        renderCpu: renderEnd - renderStart,
        streaming: vgs.isStreaming,
      })
      frame++
      if (frame >= scenario.frames) resolveDone()
    }

    const unsubscribe = [
      signals.onUpdate.subscribe(onUpdate, FIRST),
      signals.onRender.subscribe(onRender, LAST),
      signals.onPostRender.subscribe(onRendered, FIRST),
      signals.onPostRender.subscribe(onFrameEnd, LAST),
    ]

    let wasHidden = false
    const onVisibilityChange = () => {
      if (document.hidden) wasHidden = true
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    const t0 = performance.now()
    await done
    const durationMs = performance.now() - t0

    document.removeEventListener("visibilitychange", onVisibilityChange)
    muteDebug(false)
    unsubscribe.forEach((off) => off())
    scenario.end()
    Catalyst._.targetFPS = previousFps
    Catalyst._.resolution = previousResolution
    vgs.computeDesiredState = computeDesiredState
    vgs.reconcile = reconcile
    vgs.updateRenderer = updateRendererFn

    if (wasHidden)
      throw new Error("[bench] Tab was hidden during the run, result discarded")

    for (let i = 0; i < 30 && gpu.hasPending; i++) {
      await nextFrame()
      gpu.poll()
    }

    const after = vgs.splatRenderer.stats
    const sortsCompleted = after.sortsCompleted - statsBefore.sortsCompleted
    const uploadedSplats = after.uploadedSplats - statsBefore.uploadedSplats
    const memory = (performance as { memory?: { usedJSHeapSize: number } })
      .memory

    return {
      label: options.label ?? "unlabelled",
      scenario: name,
      timestamp: new Date().toISOString(),
      frames: samples.length,
      durationMs: round(durationMs, 0),
      fps: round((samples.length / durationMs) * 1000, 1),
      cpuFrameMs: roundDistribution(distribution(samples.map((s) => s.cpu))),
      desiredStateMs: roundDistribution(
        distribution(samples.map((s) => s.desiredState)),
      ),
      updateRendererMs: roundDistribution(
        distribution(samples.map((s) => s.updateRenderer)),
      ),
      renderCpuMs: roundDistribution(
        distribution(samples.map((s) => s.renderCpu)),
      ),
      gpuMs:
        gpu.supported && gpu.results.length > 0
          ? roundDistribution(distribution(gpu.results))
          : null,
      sorts: {
        dispatched: after.sortsDispatched - statsBefore.sortsDispatched,
        completed: sortsCompleted,
        perSecond: round((sortsCompleted / durationMs) * 1000, 1),
        meanMs:
          sortsCompleted > 0
            ? round((after.sortMsTotal - statsBefore.sortMsTotal) / sortsCompleted)
            : 0,
        maxMs: round(after.sortMsMax),
      },
      uploads: {
        batches: after.uploadBatches - statsBefore.uploadBatches,
        splats: uploadedSplats,
        mb: round((uploadedSplats * SPLAT_BYTES) / 1e6, 1),
        ms: round(after.uploadMsTotal - statsBefore.uploadMsTotal),
      },
      visibleSplats: after.visibleCount,
      streamingFrames: samples.filter((s) => s.streaming).length,
      heapMb: memory ? round(memory.usedJSHeapSize / 1e6, 0) : null,
    }
  }

  public async run(
    name: ScenarioName,
    options: RunOptions = {},
  ): Promise<BenchmarkResult> {
    if (options.warmup !== false) {
      await this.measure(name, { ...options, label: "warmup" })
      await this.waitForIdle()
    }

    const repeat = Math.max(1, options.repeat ?? 3)
    const runs: RunResult[] = []
    for (let i = 0; i < repeat; i++) {
      if (i > 0) await this.waitForIdle()
      runs.push(await this.measure(name, options))
    }

    const gpuP50s = runs.flatMap((r) => (r.gpuMs ? [r.gpuMs.p50] : []))
    const result: BenchmarkResult = {
      ...medianOfRuns(runs),
      timestamp: new Date().toISOString(),
      runs: repeat,
      spread: {
        cpuP95: range(runs.map((r) => r.cpuFrameMs.p95)),
        gpuP50: gpuP50s.length === repeat ? range(gpuP50s) : null,
      },
    }
    this.results.push(result)
    storeResults(this.results)
    console.log(`[bench] ${result.label} / ${name}`, result)
    return result
  }

  public async suite(
    label: string,
    options: Omit<RunOptions, "label"> = {},
  ): Promise<BenchmarkResult[]> {
    await this.waitForIdle()
    const results: BenchmarkResult[] = []
    for (const name of ["guided", "idle", "look"] as ScenarioName[]) {
      results.push(await this.run(name, { ...options, label }))
    }
    this.summary(label)
    return results
  }

  public summary(label: string): void {
    console.table(
      this.latest(label).map((r) => ({
        scenario: r.scenario,
        fps: r.fps,
        "cpu p50": r.cpuFrameMs.p50,
        "cpu p95": r.cpuFrameMs.p95,
        "gpu p50": r.gpuMs?.p50 ?? "n/a",
        "gpu p95": r.gpuMs?.p95 ?? "n/a",
        "gpu p50 range": r.spread?.gpuP50?.join(" – ") ?? "n/a",
        "sorts/s": r.sorts.perSecond,
        "sort ms": r.sorts.meanMs,
        "upload MB": r.uploads.mb,
        visible: r.visibleSplats,
      })),
    )
  }

  public compare(before: string, after: string): void {
    const a = this.latest(before)
    const b = this.latest(after)
    const change = (x: number, y: number) =>
      x === 0 ? "n/a" : `${round(((y - x) / x) * 100, 1)}%`

    console.table(
      a.flatMap((ra) => {
        const rb = b.find((r) => r.scenario === ra.scenario)
        if (!rb) return []
        return [
          {
            scenario: ra.scenario,
            "cpu p95": `${ra.cpuFrameMs.p95} → ${rb.cpuFrameMs.p95} (${change(ra.cpuFrameMs.p95, rb.cpuFrameMs.p95)})`,
            "gpu p50": `${ra.gpuMs?.p50 ?? "n/a"} → ${rb.gpuMs?.p50 ?? "n/a"}`,
            "sorts/s": `${ra.sorts.perSecond} → ${rb.sorts.perSecond}`,
            "sort ms": `${ra.sorts.meanMs} → ${rb.sorts.meanMs}`,
          },
        ]
      }),
    )
  }

  private latest(label: string): BenchmarkResult[] {
    const byScenario = new Map<ScenarioName, BenchmarkResult>()
    this.results
      .filter((r) => r.label === label)
      .forEach((r) => byScenario.set(r.scenario, r))
    return [...byScenario.values()]
  }

  public clear(): void {
    this.results = []
    storeResults(this.results)
  }
}

const setupBenchmark = (managers: ManagerRegistry): Benchmark => {
  const bench = new Benchmark(managers)
  ;(window as unknown as { bench: Benchmark }).bench = bench
  return bench
}

export default setupBenchmark
