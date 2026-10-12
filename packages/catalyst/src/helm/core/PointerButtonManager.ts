/**
 * PointerButtonManager - Tracks mouse button state.
 *
 * Mirrors KeyboardManager's API but for mouse buttons. Buttons are
 * exposed as canonical "mouse:1" through "mouse:5" codes, following
 * standard game engine convention:
 *
 *   mouse:1 → left
 *   mouse:2 → right
 *   mouse:3 → middle
 *   mouse:4 → back
 *   mouse:5 → forward
 *
 * Note the order: right comes before middle because right-click is
 * the more commonly bound button in games. This matches Source,
 * Unity, and Unreal conventions, and differs from MouseEvent.button
 * which orders them 0=left, 1=middle, 2=right.
 *
 * Friendly aliases ("mouse:left", "mouse:right", "mouse:middle") are
 * resolved by normaliseKey() in utils, so bindings can use either form.
 */

/**
 * Maps MouseEvent.button values to canonical input codes.
 */
const BUTTON_CODES: Record<number, string> = {
  0: "mouse:1", // left
  2: "mouse:2", // right
  1: "mouse:3", // middle
  3: "mouse:4", // back
  4: "mouse:5", // forward
}

export interface PointerButtonManagerConfig {
  target?: HTMLElement | Document | Window
  preventContextMenu?: boolean
}

export class PointerButtonManager {
  private buttonState: Map<string, boolean> = new Map()
  private buttonTimestamps: Map<string, number> = new Map()
  private target: HTMLElement | Document | Window
  private preventContextMenu: boolean

  private boundDown: (e: MouseEvent) => void
  private boundUp: (e: MouseEvent) => void
  private boundBlur: () => void
  private boundContextMenu: (e: Event) => void

  constructor(config: PointerButtonManagerConfig = {}) {
    this.target = config.target ?? window
    this.preventContextMenu = config.preventContextMenu ?? false

    this.boundDown = this.handleMouseDown.bind(this)
    this.boundUp = this.handleMouseUp.bind(this)
    this.boundBlur = this.clear.bind(this)
    this.boundContextMenu = (e) => e.preventDefault()

    this.bindInputs()
  }

  private bindInputs(): void {
    this.target.addEventListener("mousedown", this.boundDown as EventListener)
    // mouseup on window so releases off-target still register
    window.addEventListener("mouseup", this.boundUp)
    window.addEventListener("blur", this.boundBlur)

    if (this.preventContextMenu) {
      this.target.addEventListener("contextmenu", this.boundContextMenu)
    }
  }

  public isButtonPressed(code: string): boolean {
    return this.buttonState.get(code) ?? false
  }

  public getPressedButtons(): string[] {
    return Array.from(this.buttonState.entries())
      .filter(([_, pressed]) => pressed)
      .map(([code]) => code)
  }

  public areButtonsPressed(codes: string[]): boolean {
    return codes.every((code) => this.isButtonPressed(code))
  }

  public areAnyButtonsPressed(codes: string[]): boolean {
    return codes.some((code) => this.isButtonPressed(code))
  }

  public getButtonPressTime(code: string): number | undefined {
    return this.buttonTimestamps.get(code)
  }

  private handleMouseDown(e: MouseEvent): void {
    const code = BUTTON_CODES[e.button]
    if (!code) return
    if (!this.buttonState.get(code)) {
      this.buttonState.set(code, true)
      this.buttonTimestamps.set(code, Date.now())
    }
  }

  private handleMouseUp(e: MouseEvent): void {
    const code = BUTTON_CODES[e.button]
    if (!code) return
    this.buttonState.set(code, false)
  }

  public clear(): void {
    this.buttonState.clear()
    this.buttonTimestamps.clear()
  }

  public cleanup(): void {
    this.target.removeEventListener(
      "mousedown",
      this.boundDown as EventListener
    )
    window.removeEventListener("mouseup", this.boundUp)
    window.removeEventListener("blur", this.boundBlur)
    if (this.preventContextMenu) {
      this.target.removeEventListener("contextmenu", this.boundContextMenu)
    }
    this.clear()
  }
}
