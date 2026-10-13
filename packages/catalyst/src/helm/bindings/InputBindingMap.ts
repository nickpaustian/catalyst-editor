import { InputBinding, type BindingOptions } from "./InputBinding"

/**
 * InputBindingMap - Manages a collection of input bindings.
 *
 * Maps action names to their key bindings.
 * Allows quick lookup of actions by key.
 *
 * Example:
 * const bindings = new InputBindingMap()
 * bindings.bind("moveForward", ["w", "ArrowUp"])
 * bindings.bind("jump", "space")
 */
export class InputBindingMap {
  private bindingsByAction: Map<string, InputBinding> = new Map()
  private bindingsByKey: Map<string, string> = new Map() // key → actionName

  /**
   * Create or update a binding.
   */
  public bind(
    actionName: string,
    keys: string | string[],
    options?: BindingOptions
  ): InputBinding {
    // Remove old binding if it exists
    if (this.bindingsByAction.has(actionName)) {
      this.unbind(actionName)
    }

    // Create new binding
    const binding = new InputBinding(actionName, keys, options)

    // Store by action name
    this.bindingsByAction.set(actionName, binding)

    // Store reverse mapping (key → action) for quick lookup
    binding.getKeys().forEach((key) => {
      this.bindingsByKey.set(key, actionName)
    })

    return binding
  }

  /**
   * Remove a binding by action name.
   */
  public unbind(actionName: string): boolean {
    const binding = this.bindingsByAction.get(actionName)
    if (!binding) return false

    // Remove from reverse mapping
    binding.getKeys().forEach((key) => {
      this.bindingsByKey.delete(key)
    })

    // Remove from main mapping
    return this.bindingsByAction.delete(actionName)
  }

  /**
   * Get binding by action name.
   */
  public getBinding(actionName: string): InputBinding | undefined {
    return this.bindingsByAction.get(actionName)
  }

  /**
   * Get action name by key.
   */
  public getActionFromKey(key: string): string | undefined {
    return this.bindingsByKey.get(key)
  }

  /**
   * Get all action names.
   */
  public getActions(): string[] {
    return Array.from(this.bindingsByAction.keys())
  }

  /**
   * Check if action is bound.
   */
  public hasAction(actionName: string): boolean {
    return this.bindingsByAction.has(actionName)
  }

  /**
   * Check if key is bound to any action.
   */
  public hasKey(key: string): boolean {
    return this.bindingsByKey.has(key)
  }

  /**
   * Get all bindings.
   */
  public getAllBindings(): Map<string, InputBinding> {
    return new Map(this.bindingsByAction)
  }

  /**
   * Clear all bindings.
   */
  public clear(): void {
    this.bindingsByAction.clear()
    this.bindingsByKey.clear()
  }

  /**
   * Get number of bindings.
   */
  public getBindingCount(): number {
    return this.bindingsByAction.size
  }
}
