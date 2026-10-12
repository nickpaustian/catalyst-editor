/**
 * Context passed to action callbacks.
 * Contains timing and state information.
 */
export interface ActionContext {
  deltaTime: number
  timestamp: number
  triggerKey?: string
}

/**
 * Callbacks for an input action.
 * - start: Called once when action is triggered
 * - hold: Called repeatedly while action is held
 * - end: Called once when action is released
 */
export interface ActionCallbacks {
  start?: (context: ActionContext) => void
  hold?: (context: ActionContext) => void
  end?: (context: ActionContext) => void
}

/**
 * InputAction - Defines an action with associated callbacks.
 *
 * Actions have three phases: start, hold, and end.
 * This allows for flexible input handling (instant, sustained, release).
 *
 * Example:
 * const jumpAction = new InputAction({
 *   start: (ctx) => console.log("Jump!"),
 *   end: (ctx) => console.log("Stop jumping")
 * })
 */
export class InputAction {
  private callbacks: Required<ActionCallbacks>

  constructor(callbacks: ActionCallbacks = {}) {
    this.callbacks = {
      start: callbacks.start || (() => {}),
      hold: callbacks.hold || (() => {}),
      end: callbacks.end || (() => {}),
    }
  }

  /**
   * Trigger the start callback.
   */
  public triggerStart(context: ActionContext): void {
    this.callbacks.start(context)
  }

  /**
   * Trigger the hold callback.
   */
  public triggerHold(context: ActionContext): void {
    this.callbacks.hold(context)
  }

  /**
   * Trigger the end callback.
   */
  public triggerEnd(context: ActionContext): void {
    this.callbacks.end(context)
  }

  /**
   * Update callbacks.
   */
  public setCallbacks(callbacks: ActionCallbacks): void {
    if (callbacks.start) this.callbacks.start = callbacks.start
    if (callbacks.hold) this.callbacks.hold = callbacks.hold
    if (callbacks.end) this.callbacks.end = callbacks.end
  }
}
