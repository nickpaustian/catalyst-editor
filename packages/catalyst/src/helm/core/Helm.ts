import { KeyboardManager } from "./KeyboardManager"
import { InputBindingMap } from "../bindings/InputBindingMap"
import { InputAction, type ActionContext } from "../actions/InputAction"
import { inputSignals, type InputSignals } from "./InputSignals"
import { HoldRepeater } from "./HoldRepeater"
import {
  ScrollManager,
  type ScrollManagerConfig,
} from "../managers/ScrollManager"
import {
  PointerButtonManager,
  type PointerButtonManagerConfig,
} from "./PointerButtonManager"
import { MouseManager, type MouseManagerConfig } from "../managers/MouseManager"
import { TouchManager, type TouchManagerConfig } from "../managers/TouchManager"
import { InputMapper } from "../mapping/InputMapper"
import { resolveTarget } from "../utils"
import {
  DEFAULT_INPUT_FORCE_CONFIG,
  type InputForceConfig,
} from "../mapping/InputForceConfig"

/**
 * Helm - Singleton managing all keyboard input and action bindings.
 *
 * Orchestrates:
 * - Keyboard state tracking (KeyboardManager)
 * - Key to action bindings (InputBindingMap)
 * - Action callbacks (InputAction)
 * - Action broadcasting (InputSignals)
 *
 * Usage:
 * const input = Helm.getInstance()
 * input.bind("moveForward", ["w", "ArrowUp"])
 * input.setAction("moveForward", {
 *   start: () => console.log("Moving!"),
 *   hold: () => applyMovement(),
 *   end: () => console.log("Stopped")
 * })
 *
 * input.signals.onActionStart.subscribe(({ action }) => {
 *   console.log(`${action} started`)
 * })
 */

export interface HelmConfig {
  target?: HTMLElement | string
  mouse?: Omit<MouseManagerConfig, "inputMapper">
  scroll?: ScrollManagerConfig
  touch?: TouchManagerConfig
  force?: InputForceConfig
  pointerButtons?: PointerButtonManagerConfig
}

export class Helm {
  private static instance: Helm
  private _keyboard: KeyboardManager
  private _pointerButtons: PointerButtonManager
  private _mapper: InputMapper
  private bindings: InputBindingMap
  private actions: Map<string, InputAction> = new Map()
  private holdRepeaters: Map<string, HoldRepeater> = new Map()
  private activeActions: Set<string> = new Set()
  private _activeTriggerKeys: Map<string, string> = new Map()
  private _inputFrameId: number | null = null

  private _scroll: ScrollManager
  private _mouse: MouseManager
  private _touch: TouchManager

  public readonly signals: InputSignals = inputSignals

  public constructor(config?: HelmConfig) {
    const target = config?.target ?? null
    const forceConfig = config?.force ?? DEFAULT_INPUT_FORCE_CONFIG

    this._mapper = new InputMapper(this.signals.onForceChanged, forceConfig)
    this._scroll = new ScrollManager({
      scrollSignal: this.signals.onScroll,
      inputMapper: this.mapper,
      target,
      ...config?.scroll,
    })
    this._mouse = new MouseManager({
      inputMapper: this.mapper,
      target,
      drag: true,
      ...config?.mouse,
    })
    this._touch = new TouchManager({
      inputMapper: this.mapper,
      target,
      ...config?.touch,
    })
    this._keyboard = new KeyboardManager()
    this._pointerButtons = new PointerButtonManager({
      target:
        typeof target === "string"
          ? resolveTarget(target)
          : (target ?? window),
      ...config?.pointerButtons,
    })
    this.bindings = new InputBindingMap()

    this.startInputLoop()
  }

  /**
   * Get the singleton instance.
   */
  public static getInstance(): Helm {
    if (!Helm.instance) {
      Helm.instance = new Helm()
    }
    return Helm.instance
  }

  public static get _(): Helm {
    return Helm.getInstance()
  }

  /**
   * Get the input mapper for force-based input.
   */
  public get mapper(): InputMapper {
    return this._mapper
  }

  /**
   * Bind one or more keys to an action.
   */
  public bind(actionName: string, keys: string | string[]): void {
    this.bindings.bind(actionName, keys)
    const binding = this.bindings.getBinding(actionName)
    if (binding) {
      this.signals.onBindingChanged.emit({
        action: actionName,
        keys: binding.getKeys(),
      })
    }
  }

  /**
   * Unbind an action.
   */
  public unbind(actionName: string): void {
    this.bindings.unbind(actionName)
    this.actions.delete(actionName)
    this.holdRepeaters.get(actionName)?.stop()
    this.holdRepeaters.delete(actionName)
    this.signals.onBindingRemoved.emit({ action: actionName })
  }

  /**
   * Set the action callbacks for an action name.
   */
  public setAction(
    actionName: string,
    callbacks: {
      start?: () => void
      hold?: (context: ActionContext) => void
      end?: () => void
    }
  ): void {
    const action = new InputAction({
      start: callbacks.start ? () => callbacks.start!() : undefined,
      hold: callbacks.hold,
      end: callbacks.end ? () => callbacks.end!() : undefined,
    })
    this.actions.set(actionName, action)

    // Create hold repeater if hold callback exists
    if (callbacks.hold) {
      if (!this.holdRepeaters.has(actionName)) {
        this.holdRepeaters.set(actionName, new HoldRepeater())
      }
    }
  }

  /**
   * Check if a key is currently pressed.
   */
  public isKeyPressed(key: string): boolean {
    return this._keyboard.isKeyPressed(key)
  }

  /**
   * Get all currently pressed keys.
   */
  public getPressedKeys(): string[] {
    return this._keyboard.getPressedKeys()
  }

  /**
   * Check if an action is currently active (keys pressed).
   */
  public isActionActive(actionName: string): boolean {
    return this.activeActions.has(actionName)
  }

  /**
   * Get all currently active actions.
   */
  public getActiveActions(): string[] {
    return Array.from(this.activeActions)
  }

  /**
   * Start the input processing loop.
   */
  private startInputLoop(): void {
    const update = () => {
      this.processInput()
      this._inputFrameId = requestAnimationFrame(update)
    }
    update()
  }

  /**
   * Process input each frame.
   * Check for key changes and trigger action callbacks.
   */
  private processInput(): void {
    const now = Date.now()
    const pressedKeys = [
      ...this._keyboard.getPressedKeys(),
      ...this._pointerButtons.getPressedButtons(),
    ]
    const previouslyActive = new Set(this.activeActions)
    const currentActive = new Set<string>()

    this._mapper.update()

    for (const actionName of this.bindings.getActions()) {
      const binding = this.bindings.getBinding(actionName)
      if (!binding) continue

      const triggerKey = binding
        .getKeys()
        .find((key) => pressedKeys.includes(key))

      if (triggerKey) {
        currentActive.add(actionName)

        if (!previouslyActive.has(actionName)) {
          this.triggerActionStart(actionName, now, triggerKey)
        }
        this.triggerActionHold(actionName, now, triggerKey)
      } else if (previouslyActive.has(actionName)) {
        this.triggerActionEnd(actionName, now)
      }
    }

    this.activeActions = currentActive
  }

  /**
   * Trigger action start callback and emit signal.
   */
  private triggerActionStart(
    actionName: string,
    timestamp: number,
    triggerKey?: string
  ): void {
    if (triggerKey) this._activeTriggerKeys.set(actionName, triggerKey)

    const context: ActionContext = { deltaTime: 0, timestamp, triggerKey }

    // Emit signal
    this.signals.onActionStart.emit({
      action: actionName,
      context,
    })

    // Trigger callback if it exists
    const action = this.actions.get(actionName)
    if (action) {
      action.triggerStart(context)
    }

    // Start hold repeater if it exists
    const repeater = this.holdRepeaters.get(actionName)
    if (repeater) {
      repeater.start(() => {
        this.triggerActionHold(actionName, Date.now())
      })
    }
  }

  /**
   * Trigger action hold callback and emit signal.
   */
  private triggerActionHold(
    actionName: string,
    timestamp: number,
    triggerKey?: string
  ): void {
    const context: ActionContext = { deltaTime: 16.67, timestamp, triggerKey }

    // Emit signal
    this.signals.onActionHold.emit({
      action: actionName,
      context,
    })

    // Trigger callback if it exists
    const action = this.actions.get(actionName)
    if (action) {
      action.triggerHold(context)
    }
  }

  /**
   * Trigger action end callback and emit signal.
   */
  private triggerActionEnd(actionName: string, timestamp: number): void {
    const triggerKey = this._activeTriggerKeys.get(actionName)
    this._activeTriggerKeys.delete(actionName)
    const context: ActionContext = {
      deltaTime: 0,
      timestamp,
      triggerKey,
    }

    // Stop hold repeater if it exists
    const repeater = this.holdRepeaters.get(actionName)
    if (repeater) {
      repeater.stop()
    }

    // Emit signal
    this.signals.onActionEnd.emit({
      action: actionName,
      context,
    })

    // Trigger callback if it exists
    const action = this.actions.get(actionName)
    if (action) {
      action.triggerEnd(context)
    }
  }

  public pause(): void {
    this._scroll.pause()
    this._mouse.pause()
    // this.touch.pause()
    // this.gamepad.pause()
  }

  public resume(): void {
    this._scroll.resume()
    this._mouse.resume()
    // this.touch.resume()
    // this.gamepad.resume()
  }

  /**
   * Clear all bindings and actions.
   */
  public clear(): void {
    this.bindings.clear()
    this.actions.clear()
    this.holdRepeaters.forEach((repeater) => repeater.stop())
    this.holdRepeaters.clear()
    this.activeActions.clear()
  }

  public dispose(): void {
    if (this._inputFrameId !== null) {
      cancelAnimationFrame(this._inputFrameId)
      this._inputFrameId = null
    }

    this._scroll.cleanup()
    this._mouse.cleanup()
    this._touch.cleanup()
    this._pointerButtons.cleanup()
    this.clear()
  }
}
