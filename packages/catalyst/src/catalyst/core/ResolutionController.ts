import type * as THREE from "three"

export type ResolutionSettings =
  | { mode: "fixed"; pixelRatio: number }
  | {
      mode: "adaptive"
      movingPixelRatio: number
      stillPixelRatio: number
      settleMs: number
    }
  | {
      mode: "dynamic"
      maxPixelRatio: number
      minPixelRatio: number
      step: number
      settleMs: number
    }

export const DEFAULT_RESOLUTION: ResolutionSettings = {
  mode: "fixed",
  pixelRatio: 1,
}

const SAMPLE_FRAMES = 12
const MISSED_FRAME_FACTOR = 1.2
const RECOVER_AFTER_MS = 5000
const MAX_RECOVER_AFTER_MS = 60000

const maxRatio = (settings: { maxPixelRatio: number }) =>
  Math.min(settings.maxPixelRatio, window.devicePixelRatio)

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Picks the renderer pixel ratio each frame. Ratios are capped at the
 * display's devicePixelRatio.
 *
 * - adaptive: drops to `movingPixelRatio` as soon as the camera moves and
 *   returns to `stillPixelRatio` once it has been still for `settleMs`.
 * - dynamic: renders at `maxPixelRatio` once still for `settleMs`. While
 *   moving it steps down by `step` (not below `minPixelRatio`) only when the
 *   median frame time over the last SAMPLE_FRAMES misses the frame budget,
 *   and keeps the lower ratio for later movement. Once the recovery wait
 *   (RECOVER_AFTER_MS) has passed without a miss it tries higher again — a
 *   step while moving, or straight back to max when movement starts. A raise
 *   that misses within the wait doubles it.
 */
export class ResolutionController {
  private _settings: ResolutionSettings = DEFAULT_RESOLUTION
  private _lastMoveTime = 0
  private _lastFrameTime = 0
  private _frameTimes: number[] = []
  private _movingRatio = 1
  private _lastMissTime = 0
  private _lastRaiseTime = 0
  private _recoverAfterMs = RECOVER_AFTER_MS
  private _wasSettled = true

  public get settings(): ResolutionSettings {
    return this._settings
  }

  public set settings(settings: ResolutionSettings) {
    this._settings = settings
    this._lastMoveTime = performance.now()
    this._frameTimes = []
    if (settings.mode === "dynamic") this._movingRatio = maxRatio(settings)
    this._recoverAfterMs = RECOVER_AFTER_MS
  }

  public update(
    renderer: THREE.WebGLRenderer,
    cameraMoved: boolean,
    frameBudgetMs: number
  ): void {
    const now = performance.now()
    if (cameraMoved) this._lastMoveTime = now
    const settled = now - this._lastMoveTime >= this.settleMs

    if (this._lastFrameTime > 0) {
      this._frameTimes.push(now - this._lastFrameTime)
      if (this._frameTimes.length > SAMPLE_FRAMES) this._frameTimes.shift()
    }
    this._lastFrameTime = now

    const capped = Math.min(
      this.targetRatio(now, settled, frameBudgetMs),
      window.devicePixelRatio
    )
    if (renderer.getPixelRatio() !== capped) {
      renderer.setPixelRatio(capped)
      // Resizing the drawing buffer makes the next frame slow; don't count it
      this._frameTimes = []
      this._lastFrameTime = 0
    }
  }

  private get settleMs(): number {
    return this._settings.mode === "fixed" ? 0 : this._settings.settleMs
  }

  private targetRatio(
    now: number,
    settled: boolean,
    frameBudgetMs: number
  ): number {
    const settings = this._settings

    if (settings.mode === "fixed") return settings.pixelRatio

    if (settings.mode === "adaptive") {
      return settled ? settings.stillPixelRatio : settings.movingPixelRatio
    }

    const startedMoving = this._wasSettled && !settled
    this._wasSettled = settled
    if (settled) return maxRatio(settings)
    if (startedMoving) this._frameTimes = []

    const recovered = now - this._lastMissTime > this._recoverAfterMs
    if (startedMoving && recovered && this._movingRatio < maxRatio(settings)) {
      this._movingRatio = maxRatio(settings)
      this._lastRaiseTime = now
    }

    const missed =
      this._frameTimes.length === SAMPLE_FRAMES &&
      median(this._frameTimes) > frameBudgetMs * MISSED_FRAME_FACTOR

    if (missed) {
      if (now - this._lastRaiseTime < this._recoverAfterMs) {
        this._recoverAfterMs = Math.min(
          this._recoverAfterMs * 2,
          MAX_RECOVER_AFTER_MS
        )
      }
      this._movingRatio = Math.max(
        settings.minPixelRatio,
        this._movingRatio - settings.step
      )
      this._lastMissTime = now
      this._frameTimes = []
    } else if (
      this._movingRatio < maxRatio(settings) &&
      recovered &&
      now - this._lastRaiseTime > this._recoverAfterMs
    ) {
      this._movingRatio = Math.min(
        maxRatio(settings),
        this._movingRatio + settings.step
      )
      this._lastRaiseTime = now
    }

    return this._movingRatio
  }
}
