import {
  normaliseChord,
  chordSatisfied,
  isKeyGroup,
  resolveKeys,
} from "../utils"

export interface BindingOptions {
  /** Fire only after this many presses within `tapWindowMs` of each other. */
  taps?: number
  tapWindowMs?: number
}

/**
 * InputBinding - Maps one or more keys to an action name.
 *
 * A binding can have multiple keys that trigger the same action.
 * For example: bind both "w" and "ArrowUp" to "moveForward"
 *
 * A key may be a chord such as "shift+q" (every part held together), and a
 * binding may require several taps, e.g. { taps: 3 } for shift+q, q, q.
 *
 * Example:
 * const binding = new InputBinding("moveForward", ["w", "ArrowUp"])
 */
export class InputBinding {
  private actionName: string
  private keys: Set<string>
  private sourceGroups: Set<string> = new Set()
  public readonly taps: number
  public readonly tapWindowMs: number

  constructor(
    actionName: string,
    keys: string | string[],
    options: BindingOptions = {}
  ) {
    this.actionName = actionName
    this.keys = new Set()
    this.taps = Math.max(1, Math.floor(options.taps ?? 1))
    this.tapWindowMs = options.tapWindowMs ?? 500

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
      this.keys.add(normaliseChord(key))
    })
  }

  /** The first key or chord of this binding that the pressed keys satisfy. */
  public match(pressedKeys: string[]): string | undefined {
    return this.getKeys().find((key) => chordSatisfied(key, pressedKeys))
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
    return this.keys.has(normaliseChord(key))
  }

  /**
   * Add a key to this binding.
   */
  public addKey(key: string): void {
    this.keys.add(normaliseChord(key))
  }

  /**
   * Remove a key from this binding.
   */
  public removeKey(key: string): boolean {
    return this.keys.delete(normaliseChord(key))
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
