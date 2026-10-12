import * as THREE from "three"
import type {
  InputForceConfig,
  DualAxisInputConfig,
  SingleAxisInputConfig,
} from "./InputForceConfig"

/**
 * InputForce - Tracks and normalises input forces across all input methods.
 * Provides a unified 3D force vector (x, y, z) that can be mapped from
 * various input sources (keyboard, mouse, touch, scroll, joysticks, etc).
 */
export class InputForce {
  private _force: THREE.Vector3 = new THREE.Vector3()
  private _config: InputForceConfig
  private _isDragging: boolean = false

  constructor(config: InputForceConfig) {
    this._config = config
  }

  //=========================
  // Setters & Getters
  //=========================

  /**
   * Set the configuration.
   */
  public set config(config: InputForceConfig) {
    this._config = config
  }

  /**
   * Get the current configuration.
   */
  public get config(): InputForceConfig {
    return this._config
  }

  /**
   * Get the current force vector.
   */
  public get force(): THREE.Vector3 {
    return this._force.clone()
  }

  /**
   * Get force on a specific axis.
   */
  public getAxisForce(axis: "x" | "y" | "z"): number {
    return this._force[axis]
  }

  /**
   * Get the magnitude of the force vector.
   */
  public get magnitude(): number {
    return this._force.length()
  }

  public set dragging(value: boolean) {
    this._isDragging = value
  }

  public get dragging(): boolean {
    return this._isDragging
  }

  //=========================
  // Force
  //=========================

  /**
   * Apply scroll input to the mapped axis.
   * @param deltaY Scroll delta (positive = down, negative = up)
   */
  public applyScroll(deltaY: number): void {
    this.applySingleAxis(deltaY, this._config.scroll)
  }

  /**
   * Apply mouse movement input to the mapped axes.
   * @param deltaX Horizontal movement
   * @param deltaY Vertical movement
   */
  public applyMouseMovement(deltaX: number, deltaY: number): void {
    const config = this._config.mouse
    if ("xAxis" in config && "yAxis" in config) {
      // Dual axis
      this.applyDualAxis(deltaX, deltaY, config as DualAxisInputConfig)
    } else {
      // Separate axes
      this.applySingleAxis(deltaX, config.x)
      this.applySingleAxis(deltaY, config.y)
    }
  }

  /**
   * Apply touch movement input to the mapped axes.
   * @param deltaX Horizontal movement
   * @param deltaY Vertical movement
   */
  public applyTouchMovement(deltaX: number, deltaY: number): void {
    const config = this._config.touch
    if ("xAxis" in config && "yAxis" in config) {
      // Dual axis
      this.applyDualAxis(deltaX, deltaY, config as DualAxisInputConfig)
    } else {
      // Separate axes
      this.applySingleAxis(deltaX, config.x)
      this.applySingleAxis(deltaY, config.y)
    }
  }

  /**
   * Apply pinch/zoom input to the mapped axis.
   * @param delta Pinch delta (positive = pinch out/zoom in, negative = pinch in/zoom out)
   */
  public applyPinch(delta: number): void {
    this.applySingleAxis(delta, this._config.pinch)
  }

  /**
   * Apply joystick input to the mapped axes.
   * Joysticks typically provide normalised values (-1 to 1).
   * @param x Horizontal axis value (-1 to 1)
   * @param y Vertical axis value (-1 to 1)
   * @param config Optional custom config, defaults to touch config
   */
  public applyJoystick(
    x: number,
    y: number,
    config?: DualAxisInputConfig,
  ): void {
    this.applyDualAxis(
      x,
      y,
      config || (this._config.touch as DualAxisInputConfig),
    )
  }

  /**
   * Apply force directly to a specific axis (accumulates).
   * @param axis The axis to apply force to
   * @param value The force value
   */
  public applyDirectAxis(axis: "x" | "y" | "z", value: number): void {
    this._force[axis] += value
  }

  /**
   * Set force directly on a specific axis (overwrites instead of accumulates).
   * Useful for continuous input like joysticks.
   * @param axis The axis to set
   * @param value The force value
   */
  public setDirectAxis(axis: "x" | "y" | "z", value: number): void {
    this._force[axis] = value
  }

  /**
   * Apply force to dual axes based on config.
   * @param xValue Value for the first dimension
   * @param yValue Value for the second dimension
   * @param config Configuration specifying which axes to use
   */
  private applyDualAxis(
    xValue: number,
    yValue: number,
    config: DualAxisInputConfig,
  ): void {
    const mod = config.raw ? 1.0 : (config.modifier ?? 1.0)
    const scaledX = xValue * mod
    const scaledY = yValue * mod

    this.applyDirectAxis(config.xAxis, scaledX)
    this.applyDirectAxis(config.yAxis, scaledY)
  }

  /**
   * Apply force to a single axis based on config.
   * @param value The force value
   * @param config Configuration specifying which axis to use
   */
  private applySingleAxis(value: number, config: SingleAxisInputConfig): void {
    const mod = config.raw ? 1.0 : (config.modifier ?? 1.0)
    const scaledValue = value * mod

    this.applyDirectAxis(config.axis, scaledValue)
  }

  public update(): void {
    this.applyDecay(this._config.scroll)
    this.applyDecay(this._config.pinch)

    const mouseConfig = this._config.mouse
    if ("xAxis" in mouseConfig && "yAxis" in mouseConfig) {
      this.applyDecay(mouseConfig as DualAxisInputConfig)
    } else {
      this.applyDecay((mouseConfig as any).x)
      this.applyDecay((mouseConfig as any).y)
    }

    const touchConfig = this._config.touch
    if ("xAxis" in touchConfig && "yAxis" in touchConfig) {
      this.applyDecay(touchConfig as DualAxisInputConfig)
    } else {
      this.applyDecay((touchConfig as any).x)
      this.applyDecay((touchConfig as any).y)
    }
  }

  private applyDecay(
    config: SingleAxisInputConfig | DualAxisInputConfig,
  ): void {
    const decay = "decay" in config ? config.decay : undefined

    if (decay === undefined) return

    if ("axis" in config) {
      this._force[config.axis] *= decay
    } else {
      this._force[config.xAxis] *= decay
      this._force[config.yAxis] *= decay
    }
  }

  /**
   * Clear all forces.
   */
  public clear(): void {
    this._force.set(0, 0, 0)
  }
}
