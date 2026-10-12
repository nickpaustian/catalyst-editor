/**
 * Signal - A simple event emitter/broadcaster for decoupled communication.
 *
 * Allows systems to emit signals and other systems to listen without direct dependencies.
 * Supports priority-based execution order for subscribers.
 * Listeners with the same priority execute simultaneously (in parallel-like manner).
 */
export class Signal<T = void> {
  private listeners: Map<number, Set<(data: T) => void>> = new Map()
  private emitStack: number = 0
  private pendingEmits: Array<{ priority: number; data: T }> = []

  /**
   * Subscribe to this signal.
   * @param callback Function to call when signal is emitted
   * @param priority Execution order (higher = executes first). Default: 0
   * @returns Unsubscribe function
   */
  public subscribe(
    callback: (data: T) => void,
    priority: number = 0
  ): () => void {
    if (!this.listeners.has(priority)) {
      this.listeners.set(priority, new Set())
    }

    this.listeners.get(priority)!.add(callback)

    // Return unsubscribe function
    return () => {
      this.unsubscribe(callback, priority)
    }
  }

  /**
   * Unsubscribe from this signal.
   */
  public unsubscribe(callback: (data: T) => void, priority: number = 0): void {
    this.listeners.get(priority)?.delete(callback)

    // Clean up empty priority maps
    if (this.listeners.get(priority)?.size === 0) {
      this.listeners.delete(priority)
    }
  }

  /**
   * Emit the signal to all listeners in priority order.
   * If already emitting, queues the emit for next available tick.
   * Listeners with the same priority execute simultaneously.
   */
  public emit(data: T): void {
    // If we're already in an emit stack, queue for later
    if (this.emitStack > 0) {
      this.pendingEmits.push({ priority: 0, data })
      return
    }

    this.emitStack++
    this.executeEmit(data)
    this.emitStack--

    // Process queued emits after we're done with the current one
    if (this.emitStack === 0) {
      while (this.pendingEmits.length > 0) {
        const { data: nextData } = this.pendingEmits.shift()!
        this.emitStack++
        this.executeEmit(nextData)
        this.emitStack--
      }
    }
  }

  /**
   * Execute the actual emit, calling listeners in priority order.
   * Listeners with the same priority execute simultaneously.
   */
  private executeEmit(data: T): void {
    // Sort priorities in descending order (higher priority first)
    const sortedPriorities = Array.from(this.listeners.keys()).sort(
      (a, b) => b - a
    )

    sortedPriorities.forEach((priority) => {
      const listeners = this.listeners.get(priority)
      if (listeners) {
        // Execute all listeners at this priority level simultaneously
        listeners.forEach((callback) => {
          try {
            callback(data)
          } catch (error) {
            console.error(
              `Error in Signal listener with priority ${priority}:`,
              error
            )
          }
        })
      }
    })
  }

  /**
   * Get the number of active listeners.
   */
  public getListenerCount(): number {
    let count = 0
    this.listeners.forEach((set) => (count += set.size))
    return count
  }

  /**
   * Clear all listeners.
   */
  public clear(): void {
    this.listeners.clear()
    this.pendingEmits = []
    this.emitStack = 0
  }
}
