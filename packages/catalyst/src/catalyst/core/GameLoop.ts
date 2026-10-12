/**
 * GameLoop - Manages the main game loop with consistent delta time.
 */
export class GameLoop {
  private animationFrameId: number | null = null
  private isRunning: boolean = false
  private lastFrameTime: number = 0
  private callback: ((deltaTime: number) => void) | null = null

  /**
   * Start the game loop with a callback.
   * @param callback Function to call each frame with deltaTime in milliseconds
   */
  public start(callback: (deltaTime: number) => void): void {
    if (this.isRunning) {
      console.warn("GameLoop is already running")
      return
    }

    this.callback = callback
    this.isRunning = true
    this.lastFrameTime = performance.now()

    this.loop()
  }

  /**
   * Stop the game loop.
   */
  public stop(): void {
    if (!this.isRunning) {
      console.warn("GameLoop is not running")
      return
    }

    this.isRunning = false

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }

  /**
   * The main loop function.
   */
  private loop = (): void => {
    const currentTime = performance.now()
    const deltaTime = currentTime - this.lastFrameTime
    this.lastFrameTime = currentTime

    // Call the update/render callback
    if (this.callback) {
      this.callback(deltaTime)
    }

    // Schedule the next frame
    if (this.isRunning) {
      this.animationFrameId = requestAnimationFrame(this.loop)
    }
  }

  /**
   * Check if the loop is currently running.
   */
  public getIsRunning(): boolean {
    return this.isRunning
  }
}
