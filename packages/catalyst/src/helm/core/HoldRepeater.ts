/**
 * HoldRepeater - Manages timing for hold actions.
 *
 * Triggers a callback repeatedly while a key is held.
 */
export class HoldRepeater {
  private intervalId: number | null = null
  private timeoutId: number | null = null
  private isActive: boolean = false

  /**
   * Start repeating the callback.
   * @param callback Function to call repeatedly
   * @param initialDelay Delay before first repeat (ms)
   * @param repeatRate Time between repeats (ms)
   */
  public start(
    callback: () => void,
    initialDelay: number = 0,
    repeatRate: number = 16
  ): void {
    if (this.isActive) return

    this.isActive = true

    // Start repeating after initial delay
    this.timeoutId = window.setTimeout(() => {
      if (this.isActive) {
        this.intervalId = window.setInterval(callback, repeatRate)
      }
    }, initialDelay)
  }

  /**
   * Stop repeating.
   */
  public stop(): void {
    this.isActive = false

    if (this.intervalId !== null) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }

    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }
  }

  /**
   * Check if repeater is active.
   */
  public isRunning(): boolean {
    return this.isActive
  }
}
