import { normaliseKey, isKeyGroup, resolveKeys } from "../utils"

/**
 * InputBinding - Maps one or more keys to an action name.
 *
 * A binding can have multiple keys that trigger the same action.
 * For example: bind both "w" and "ArrowUp" to "moveForward"
 *
 * Example:
 * const binding = new InputBinding("moveForward", ["w", "ArrowUp"])
 */
export class InputBinding {
  private actionName: string
  private keys: Set<string>
  private sourceGroups: Set<string> = new Set()

  constructor(actionName: string, keys: string | string[]) {
    this.actionName = actionName
    this.keys = new Set()

    // Track source groups for later identification
    const keyArray = Array.isArray(keys) ? keys : [keys]
    keyArray.forEach((key) => {
      if (isKeyGroup(key)) {
        this.sourceGroups.add(key.toLowerCase())
      }
    })

    // Resolve groups, then normalise
    const resolved = resolveKeys(keys)
    resolved.forEach((key) => {
      this.keys.add(normaliseKey(key))
    })
  }

  /**
   * Get the action name.
   */
  public getActionName(): string {
    return this.actionName
  }

  /**
   * Get all keys for this binding.
   */
  public getKeys(): string[] {
    return Array.from(this.keys)
  }

  /**
   * Check if a key is part of this binding.
   */
  public hasKey(key: string): boolean {
    return this.keys.has(normaliseKey(key))
  }

  /**
   * Add a key to this binding.
   */
  public addKey(key: string): void {
    this.keys.add(normaliseKey(key))
  }

  /**
   * Remove a key from this binding.
   */
  public removeKey(key: string): boolean {
    return this.keys.delete(normaliseKey(key))
  }

  /**
   * Check if binding has any keys.
   */
  public hasKeys(): boolean {
    return this.keys.size > 0
  }

  /**
   * Get number of keys in this binding.
   */
  public getKeyCount(): number {
    return this.keys.size
  }

  public hasSourceGroup(groupName: string): boolean {
    return this.sourceGroups.has(groupName.toLowerCase())
  }
}
