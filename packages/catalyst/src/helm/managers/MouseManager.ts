import type { InputMapper } from "../mapping/InputMapper"
import { resolveTarget } from "../utils"

export interface MouseManagerConfig {
  inputMapper: InputMapper
  drag?: boolean
  target?: HTMLElement | string | null
}

export class MouseManager {
  private _inputMapper: InputMapper | null = null
  private _requireDrag: boolean
  private _target: HTMLElement | Document
  private _isMouseDown: boolean = false
  private _isActive: boolean = true

  private _onMouseMove: (event: MouseEvent) => void
  private _onMouseDown: () => void
  private _onMouseUp: () => void

  constructor(config: MouseManagerConfig) {
    this._requireDrag = config?.drag ?? false
    this._inputMapper = config.inputMapper || null

    this._target = resolveTarget(config.target)

    this._onMouseMove = (event: MouseEvent) => this.handleMouseMove(event)
    this._onMouseDown = () => {
      this._isMouseDown = true
      if (this._inputMapper) this._inputMapper.inputForce.dragging = true
    }

    this._onMouseUp = () => {
      this._isMouseDown = false
      if (this._inputMapper) this._inputMapper.inputForce.dragging = false
      this._inputMapper?.releasePointer()
    }

    this.setupListeners()
  }

  public set inputMapper(inputMapper: InputMapper) {
    this._inputMapper = inputMapper
  }

  private setupListeners(): void {
    this._target.addEventListener(
      "mousemove",
      this._onMouseMove as EventListener,
    )
    this._target.addEventListener("mousedown", this._onMouseDown)
    this._target.addEventListener("mouseup", this._onMouseUp)
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this._isActive) return
    if (this._inputMapper) {
      this._inputMapper.updatePointer(event.clientX, event.clientY, "mouse")
    }
    if (this._requireDrag && !this._isMouseDown) return

    if (this._inputMapper) {
      this._inputMapper.handleMouseMovement(event.movementX, event.movementY)
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
      "mousemove",
      this._onMouseMove as EventListener,
    )
    this._target.removeEventListener("mousedown", this._onMouseDown)
    this._target.removeEventListener("mouseup", this._onMouseUp)
  }
}
