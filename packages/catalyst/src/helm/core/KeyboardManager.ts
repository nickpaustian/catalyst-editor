import { normaliseKey } from "../utils"

/**
 * KeyboardManager - Tracks keyboard input state.
 *
 * Monitors key presses and releases, normalising key names for consistency.
 * Provides query methods to check current key state.
 */
export class KeyboardManager {
  private keyState: Map<string, boolean> = new Map()
  private keyTimestamps: Map<string, number> = new Map()

  constructor() {
    this.bindInputs()
  }

  /**
   * Bind to window keyboard events.
   */
  private bindInputs(): void {
    window.addEventListener("keydown", this.handleKeyDown.bind(this))
    window.addEventListener("keyup", this.handleKeyUp.bind(this))
    window.addEventListener("blur", this.handleWindowBlur.bind(this))
  }

  /**
   * Check if a key is currently pressed.
   */
  public isKeyPressed(key: string): boolean {
    return this.keyState.get(normaliseKey(key)) ?? false
  }

  /**
   * Get all currently pressed keys.
   */
  public getPressedKeys(): string[] {
    return Array.from(this.keyState.entries())
      .filter(([_, pressed]) => pressed)
      .map(([key, _]) => key)
  }

  /**
   * Check if all specified keys are pressed.
   */
  public areKeysPressed(keys: string[]): boolean {
    return keys.every((key) => this.isKeyPressed(key))
  }

  /**
   * Check if any of the specified keys are pressed.
   */
  public areAnyKeysPressed(keys: string[]): boolean {
    return keys.some((key) => this.isKeyPressed(key))
  }

  /**
   * Get the timestamp when a key was pressed.
   */
  public getKeyPressTime(key: string): number | undefined {
    return this.keyTimestamps.get(normaliseKey(key))
  }

  /**
   * Handle keydown event.
   */
  private handleKeyDown(e: KeyboardEvent): void {
    const key = normaliseKey(e.key)
    if (!this.keyState.get(key)) {
      this.keyState.set(key, true)
      this.keyTimestamps.set(key, Date.now())
    }
  }

  /**
   * Handle keyup event.
   */
  private handleKeyUp(e: KeyboardEvent): void {
    const key = normaliseKey(e.key)
    this.keyState.set(key, false)
  }

  /**
   * Handle window blur - clear all key states.
   */
  private handleWindowBlur(): void {
    this.clear()
  }

  /**
   * Clear all key states.
   */
  public clear(): void {
    this.keyState.clear()
    this.keyTimestamps.clear()
  }
}
