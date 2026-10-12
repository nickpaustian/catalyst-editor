import * as THREE from "three"
import { InputForce } from "./InputForce"
import {
  DEFAULT_INPUT_FORCE_CONFIG,
  type InputForceConfig,
} from "./InputForceConfig"
import { Signal } from "@vitrine/catalyst/signals"
import type { ScrollData } from "../managers/ScrollManager"

export interface InputForceData {
  force: THREE.Vector3
}

export type PointerType = "mouse" | "touch" | "pinch"

export interface PointerState {
  x: number
  y: number
  type: PointerType
  active: boolean
}

/**
 * InputMapper - Routes raw input events from various input managers
 * into a normalised InputForce system based on configuration.
 */
export class InputMapper {
  private _inputForce: InputForce
  private _pointer: PointerState = { x: 0, y: 0, type: "mouse", active: false }
  private _config: InputForceConfig

  // Signal for when input force changes
  private onForceChanged: Signal<InputForceData>

  constructor(
    forceChangeSignal?: Signal<InputForceData>,
    config: InputForceConfig = DEFAULT_INPUT_FORCE_CONFIG,
  ) {
    this._config = config
    this._inputForce = new InputForce(config)
    this.onForceChanged = forceChangeSignal ?? new Signal<InputForceData>()
  }

  //=========================
  // Getters & Setters
  //=========================

  public get inputForce(): InputForce {
    return this._inputForce
  }

  public get pointer(): PointerState {
    return this._pointer
  }

  /**
   * Get the current input force.
   */
  public get force(): THREE.Vector3 {
    return this._inputForce.force
  }

  /**
   * Get force on a specific axis.
   */
  public getAxisForce(axis: "x" | "y" | "z"): number {
    return this._inputForce.getAxisForce(axis)
  }

  /**
   * Update the input configuration.
   */
  public set config(config: InputForceConfig) {
    this._config = config
    this._inputForce.config = config
  }

  /**
   * Get the current configuration.
   */
  public get config(): InputForceConfig {
    return this._config
  }

  public updatePointer(x: number, y: number, type: PointerType): void {
    this._pointer.x = x
    this._pointer.y = y
    this._pointer.type = type
    this._pointer.active = true
  }

  public releasePointer(): void {
    this._pointer.active = false
  }

  //=========================
  // Map Forces
  //=========================

  public update(): void {
    this._inputForce.update()
  }

  /**
   * Handle scroll input.
   */
  public handleScroll(scrollData: ScrollData): void {
    this._inputForce.applyScroll(scrollData.deltaY)
    this.onForceChanged.emit({ force: this.force })
  }

  /**
   * Handle mouse movement input.
   */
  public handleMouseMovement(deltaX: number, deltaY: number): void {
    this._inputForce.applyMouseMovement(deltaX, deltaY)
    this.onForceChanged.emit({ force: this.force })
  }

  /**
   * Handle touch movement input.
   */
  public handleTouchMovement(deltaX: number, deltaY: number): void {
    this._inputForce.applyTouchMovement(deltaX, deltaY)
    this.onForceChanged.emit({ force: this.force })
  }

  /**
   * Handle pinch input.
   */
  public handlePinch(delta: number): void {
    this._inputForce.applyPinch(delta)
    this.onForceChanged.emit({ force: this.force })
  }

  /**
   * Handle joystick input (virtual or gamepad).
   */
  public handleJoystick(x: number, y: number): void {
    this._inputForce.applyJoystick(x, y)
    this.onForceChanged.emit({ force: this.force })
  }

  //=========================
  // Cleanup
  //=========================

  /**
   * Clear all accumulated forces.
   */
  public clearForces(): void {
    this._inputForce.clear()
    this.onForceChanged.emit({ force: this.force })
  }
}
