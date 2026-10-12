import { Spring, type SpringConfig } from "./Spring"

export type TetherMode = "synced" | "spring" | "detached"

export interface TetherConfig {
  anchor: HTMLElement | string
  target: HTMLElement
  mode?: TetherMode
  spring?: SpringConfig
  syncThreshold?: number
  onSynced?: () => void
  onDetached?: () => void
}

const TETHER_DEFAULTS = {
  syncThreshold: 0.5,
}

export class Tether {
  private _anchor: HTMLElement | null
  private _target: HTMLElement
  private _mode: TetherMode = "detached"
  private _spring: Spring
  private _syncThreshold: number

  private _frameId: number | null = null
  private _lastTime: number = 0
  private _isActive: boolean = false

  // Current position/size of target
  private _x: number = 0
  private _y: number = 0
  private _width: number = 0
  private _height: number = 0

  // Velocity for spring mode
  private _vx: number = 0
  private _vy: number = 0
  private _vw: number = 0
  private _vh: number = 0

  // Callbacks
  private _onSynced: (() => void) | null
  private _onDetached: (() => void) | null

  constructor(config: TetherConfig) {
    this._anchor =
      typeof config.anchor === "string"
        ? document.querySelector(config.anchor)
        : config.anchor

    if (!this._anchor) {
      throw new Error(`[Tether] Anchor not found: ${config.anchor}`)
    }

    this._target = config.target
    this._spring = new Spring(config.spring)
    this._syncThreshold = config.syncThreshold ?? TETHER_DEFAULTS.syncThreshold
    this._onSynced = config.onSynced ?? null
    this._onDetached = config.onDetached ?? null

    if (config.mode && config.mode !== "detached") {
      config.mode === "synced" ? this.attachImmediate() : this.attach()
    }
  }

  public get mode(): TetherMode {
    return this._mode
  }

  public attach(): void {
    this._mode = "spring"
    this.captureTargetPosition()
    this.startLoop()
  }

  public attachImmediate(): void {
    this._mode = "synced"
    this.syncToAnchor()
    this.startLoop()
  }

  public detach(): void {
    this._mode = "detached"
    this.stopLoop()
    this._onDetached?.()
  }

  private captureTargetPosition(): void {
    const rect = this._target.getBoundingClientRect()
    this._x = rect.left
    this._y = rect.top
    this._width = rect.width
    this._height = rect.height
  }

  private syncToAnchor(): void {
    if (!this._anchor) return
    const rect = this._anchor.getBoundingClientRect()
    this._x = rect.left
    this._y = rect.top
    this._width = rect.width
    this._height = rect.height
    this.applyPosition()
  }

  private applyPosition(): void {
    this._target.style.left = `${this._x}px`
    this._target.style.top = `${this._y}px`
    this._target.style.width = `${this._width}px`
    this._target.style.height = `${this._height}px`
  }

  private startLoop(): void {
    if (this._isActive) return
    this._isActive = true
    this._lastTime = performance.now()
    this.tick()
  }

  private stopLoop(): void {
    if (!this._isActive) return
    this._isActive = false
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId)
      this._frameId = null
    }
  }

  private tick(): void {
    if (!this._isActive) return
    this._frameId = requestAnimationFrame((t) => {
      const dt = (t - this._lastTime) / 1000
      this._lastTime = t
      this.update(dt)
      this.tick()
    })
  }

  private update(_dt: number): void {
    if (!this._anchor) return

    if (this._mode === "synced") {
      this.syncToAnchor()
      return
    }

    if (this._mode === "spring") {
      const anchor = this._anchor.getBoundingClientRect()

      this._vx += this._spring.force(this._x, anchor.left, this._vx)
      this._vy += this._spring.force(this._y, anchor.top, this._vy)
      this._vw += this._spring.force(this._width, anchor.width, this._vw)
      this._vh += this._spring.force(this._height, anchor.height, this._vh)

      this._x += this._vx
      this._y += this._vy
      this._width += this._vw
      this._height += this._vh

      this.applyPosition()

      const settled =
        Math.abs(this._x - anchor.left) < this._syncThreshold &&
        Math.abs(this._y - anchor.top) < this._syncThreshold &&
        Math.abs(this._width - anchor.width) < this._syncThreshold &&
        Math.abs(this._height - anchor.height) < this._syncThreshold &&
        Math.abs(this._vx) < this._syncThreshold &&
        Math.abs(this._vy) < this._syncThreshold

      if (settled) {
        this._vx = 0
        this._vy = 0
        this._vw = 0
        this._vh = 0
        this._mode = "synced"
        this._onSynced?.()
      }
    }
  }

  public dispose(): void {
    this.stopLoop()
    this._anchor = null
    this._onSynced = null
    this._onDetached = null
  }
}
