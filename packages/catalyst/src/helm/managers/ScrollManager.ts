import { Signal } from "@vitrine/catalyst/signals"
import type { InputMapper } from "../mapping/InputMapper"
import { resolveTarget } from "../utils"

export interface ScrollData {
  deltaY: number
  deltaX: number
  timestamp: number
}

export interface ScrollManagerConfig {
  scrollSignal: Signal<ScrollData>
  inputMapper?: InputMapper
  target?: HTMLElement | string | null
}

export class ScrollManager {
  private scrollSignal: Signal<ScrollData>
  private scrollHandler: (event: WheelEvent) => void
  private _inputMapper: InputMapper | null = null
  private _target: HTMLElement | Document
  private _isActive: boolean = true

  constructor(config: ScrollManagerConfig) {
    this.scrollSignal = config.scrollSignal
    this._inputMapper = config?.inputMapper || null
    this._target = resolveTarget(config.target)
    this.scrollHandler = (event) => this.handleScroll(event)
    this.setupListeners()
  }

  //=========================
  // Setters & Getters
  //=========================

  public set inputMapper(inputMapper: InputMapper) {
    this._inputMapper = inputMapper
  }

  //=========================
  // Listener
  //=========================

  public get onScroll(): Signal<ScrollData> {
    return this.scrollSignal
  }

  private setupListeners(): void {
    this._target.addEventListener(
      "wheel",
      this.scrollHandler as EventListener,
      { passive: false },
    )
  }

  private handleScroll(event: WheelEvent): void {
    if (!this._isActive) return
    event.preventDefault()

    if (this._inputMapper) {
      this._inputMapper.updatePointer(event.clientX, event.clientY, "mouse")
    }

    const scrollData: ScrollData = {
      deltaY: event.deltaY,
      deltaX: event.deltaX,
      timestamp: Date.now(),
    }

    // Emit raw scroll data
    this.scrollSignal.emit(scrollData)

    // Apply to input mapper if available
    if (this._inputMapper) this._inputMapper.handleScroll(scrollData)
  }

  public pause(): void {
    this._isActive = false
  }

  public resume(): void {
    this._isActive = true
  }

  //=========================
  // Cleanup
  //=========================

  public cleanup(): void {
    this._target.removeEventListener(
      "wheel",
      this.scrollHandler as EventListener,
    )
  }
}
