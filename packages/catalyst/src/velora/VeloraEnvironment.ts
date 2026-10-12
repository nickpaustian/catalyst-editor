import * as THREE from "three"

import { RigidBody } from "./bodies/RigidBody"
import { Collider } from "./colliders/Collider"

/**
 * Global physics configuration that can be overridden per-object.
 */
export interface PhysicsConfig {
  gravity: number
  drag: number
  groundPlaneHeight: number | null
  defaultScene: THREE.Scene | null
  debugWireframeColour: number
}

/**
 * VeloraEnvironment singleton - manages global physics properties.
 * Individual objects can override these settings, but this provides sensible defaults.
 */
export class VeloraEnvironment {
  private static instance: VeloraEnvironment
  private _config: PhysicsConfig = {
    gravity: 9.8,
    drag: 0.1,
    groundPlaneHeight: null,
    defaultScene: null,
    debugWireframeColour: 0xff00ff,
  }

  private _bodies: RigidBody[] = []
  private _colliders: Collider[] = []

  private constructor() {}

  /**
   * Get the singleton instance.
   */
  public static getInstance(): VeloraEnvironment {
    if (!VeloraEnvironment.instance) {
      VeloraEnvironment.instance = new VeloraEnvironment()
    }
    return VeloraEnvironment.instance
  }

  public static get _(): VeloraEnvironment {
    return VeloraEnvironment.getInstance()
  }

  /**
   * Get global gravity.
   */
  public get gravity(): number {
    return this._config.gravity
  }

  /**
   * Set global gravity.
   */
  public set gravity(value: number) {
    this._config.gravity = Math.max(0, value)
  }

  /**
   * Get global drag coefficient.
   */
  public get drag(): number {
    return this._config.drag
  }

  /**
   * Set global drag coefficient.
   */
  public set drag(value: number) {
    this._config.drag = Math.max(0, Math.min(1, value))
  }

  /**
   * Get global ground plane height (safety floor).
   * Set to null to disable.
   */
  public get groundPlaneHeight(): number | null {
    return this._config.groundPlaneHeight
  }

  /**
   * Set global ground plane height (safety floor).
   * Set to null to disable. Objects won't fall below this y-value.
   */
  public set groundPlaneHeight(value: number | null) {
    this._config.groundPlaneHeight = value
  }

  /**
   * Get the default scene for colliders.
   * If set, colliders will use this scene automatically if no scene is explicitly provided.
   */
  public get defaultScene(): THREE.Scene | null {
    return this._config.defaultScene
  }

  /**
   * Set the default scene for colliders.
   * If set, colliders will use this scene automatically if no scene is explicitly provided.
   */
  public set defaultScene(value: THREE.Scene | null) {
    this._config.defaultScene = value
  }

  /**
   * Register a physics body with the environment.
   */
  public registerBody(body: RigidBody): void {
    if (!this._bodies.includes(body)) {
      this._bodies.push(body)
    }
  }

  /**
   * Unregister a physics body from the environment.
   */
  public unregisterBody(body: RigidBody): void {
    const index = this._bodies.indexOf(body)
    if (index !== -1) {
      this._bodies.splice(index, 1)
    }
  }

  /**
   * Register a standalone collider.
   * Useful for static scene geometry.
   */
  public registerCollider(collider: Collider): void {
    if (!this._colliders.includes(collider)) {
      this._colliders.push(collider)
    }
  }

  /**
   * Unregister a standalone collider.
   */
  public unregisterCollider(collider: Collider): void {
    const index = this._colliders.indexOf(collider)
    if (index !== -1) {
      this._colliders.splice(index, 1)
    }
  }

  /**
   * Get all registered colliders.
   */
  public getColliders(): Collider[] {
    return this._colliders
  }

  /**
   * Update all physics bodies.
   */
  public update(deltaTime: number): void {
    this._bodies.forEach((body) =>
      body.update(deltaTime / 1000, this._colliders)
    )
  }

  /**
   * Get the debug wireframe colour for visualised colliders.
   */
  public get debugWireframeColour(): number {
    return this._config.debugWireframeColour
  }

  /**
   * Set the debug wireframe colour for visualised colliders.
   */
  public set debugWireframeColour(value: number) {
    this._config.debugWireframeColour = value
  }

  /**
   * Get entire config object.
   */
  public getConfig(): PhysicsConfig {
    return { ...this._config }
  }

  /**
   * Set multiple config values at once.
   */
  public setConfig(config: Partial<PhysicsConfig>): void {
    if (config.gravity !== undefined) {
      this.gravity = config.gravity
    }
    if (config.drag !== undefined) {
      this.drag = config.drag
    }
    if (config.groundPlaneHeight !== undefined) {
      this.groundPlaneHeight = config.groundPlaneHeight
    }
    if (config.defaultScene !== undefined) {
      this.defaultScene = config.defaultScene
    }
    if (config.debugWireframeColour !== undefined) {
      this.debugWireframeColour = config.debugWireframeColour
    }
  }

  /**
   * Reset to default values.
   */
  public reset(): void {
    this._config = {
      gravity: 9.8,
      drag: 0.1,
      groundPlaneHeight: null,
      defaultScene: null,
      debugWireframeColour: 0xff00ff,
    }
  }
}
