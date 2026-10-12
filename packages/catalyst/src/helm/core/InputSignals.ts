import { Signal } from "@vitrine/catalyst/signals"
import type { ActionContext } from "../actions/InputAction"
import { type ScrollData } from "../managers/ScrollManager"
import type { InputForceData } from "../mapping/InputMapper"

export type InputSignals = {
  onActionStart: Signal<{
    action: string
    context: ActionContext
  }>
  onActionHold: Signal<{
    action: string
    context: ActionContext
  }>
  onActionEnd: Signal<{
    action: string
    context: ActionContext
  }>
  onBindingChanged: Signal<{
    action: string
    keys: string[]
  }>
  onBindingRemoved: Signal<{
    action: string
  }>
  onForceChanged: Signal<InputForceData>
  onScroll: Signal<ScrollData>
}

/**
 * InputSignals - Centralised signal definitions for input events.
 */
export const inputSignals: InputSignals = {
  /**
   * Fired when an action starts (key pressed).
   * Listeners receive the action name and context.
   */
  onActionStart: new Signal<{
    action: string
    context: ActionContext
  }>(),

  /**
   * Fired repeatedly while an action is held.
   * Listeners receive the action name and context.
   */
  onActionHold: new Signal<{
    action: string
    context: ActionContext
  }>(),

  /**
   * Fired when an action ends (key released).
   * Listeners receive the action name and context.
   */
  onActionEnd: new Signal<{
    action: string
    context: ActionContext
  }>(),

  /**
   * Fired when a binding is added or changed.
   */
  onBindingChanged: new Signal<{
    action: string
    keys: string[]
  }>(),

  /**
   * Fired when a binding is removed.
   */
  onBindingRemoved: new Signal<{
    action: string
  }>(),

  /**
   * Fired when the input force changes.
   */
  onForceChanged: new Signal<InputForceData>(),

  /**
   * Fired when the user scrolls.
   * Listeners receive scroll delta information.
   */
  onScroll: new Signal<ScrollData>(),
}
