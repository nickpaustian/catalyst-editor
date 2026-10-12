import type { InputMapper } from "../mapping/InputMapper"
import { resolveTarget } from "../utils"

export interface TouchManagerConfig {
  inputMapper?: InputMapper
  target?: HTMLElement | string | null
}

export class TouchManager {
  private _inputMapper: InputMapper | null = null
  private _target: HTMLElement | Document
  private lastTouchX: number = 0
  private lastTouchY: number = 0
  private _isActive: boolean = true

  private _onTouchStart: (event: TouchEvent) => void
  private _onTouchMove: (event: TouchEvent) => void
  private _onTouchEnd: (event: TouchEvent) => void

  constructor(config: TouchManagerConfig) {
    this._inputMapper = config.inputMapper ?? null
    this._target = resolveTarget(config.target)

    this._onTouchStart = (event: TouchEvent) => {
      this.handleTouchStart(event)
      if (this._inputMapper) this._inputMapper.inputForce.dragging = true
    }

    this._onTouchEnd = () => {
      if (this._inputMapper) this._inputMapper.inputForce.dragging = false
    }
    this._onTouchMove = (event: TouchEvent) => this.handleTouchMove(event)

    this.setupListeners()
  }

  public set inputMapper(inputMapper: InputMapper) {
    this._inputMapper = inputMapper
  }

  private setupListeners(): void {
    this._target.addEventListener(
      "touchstart",
      this._onTouchStart as EventListener,
    )
    this._target.addEventListener(
      "touchmove",
      this._onTouchMove as EventListener,
    )

    this._target.addEventListener("touchend", this._onTouchEnd as EventListener)
  }

  private handleTouchStart(event: TouchEvent): void {
    if (!this._isActive) return
    const touch = event.touches[0]
    this.lastTouchX = touch.clientX
    this.lastTouchY = touch.clientY
  }

  private handleTouchMove(event: TouchEvent): void {
    if (!this._isActive) return
    const touch = event.touches[0]
    const deltaX = touch.clientX - this.lastTouchX
    const deltaY = touch.clientY - this.lastTouchY

    this.lastTouchX = touch.clientX
    this.lastTouchY = touch.clientY

    if (this._inputMapper) {
      this._inputMapper.handleTouchMovement(deltaX, deltaY)
    }
  }

  public pause(): void {
    this._isActive = false
  }

  public resume(): void {
    this._isActive = true
  }

  public cleanup(): void {
    this._target.removeEventListener(
      "touchstart",
      this._onTouchStart as EventListener,
    )
    this._target.removeEventListener(
      "touchmove",
      this._onTouchMove as EventListener,
    )
    this._target.removeEventListener(
      "touchend",
      this._onTouchEnd as EventListener,
    )
  }
}
