import * as THREE from "three"
import { Catalyst } from "../core"
import { Node3D } from "./Node3D"
import { Collider } from "./Collider"
import { RigidBody as VeloraRigidBody } from "@vitrine/catalyst/velora/bodies/RigidBody"
import type { Signal } from "../signals"

interface RigidBodyNodeConfig {
  name?: string
  mass?: number
  drag?: number
  useGravity?: boolean
  gravity?: number
  groundPlaneHeight?: number | null
  collider?: Collider
  syncParent?: boolean
}

/**
 * RigidBody - A spatial node wrapping Velora's RigidBody.
 */
export class RigidBody extends Node3D {
  private static readonly COLLIDER_KEY = "__collider__"
  private _rigidBody: VeloraRigidBody
  private _collider: Collider | null = null
  private syncParent: Boolean

  constructor(config: RigidBodyNodeConfig = {}) {
    super(config?.name ?? "rigidBody")

    const catalyst = Catalyst._
    const velora = catalyst.physics

    this._rigidBody = new VeloraRigidBody(new THREE.Vector3(), {
      mass: config.mass ?? 1.0,
      drag: config.drag ?? velora?.drag,
      useGravity: config.useGravity ?? true,
      gravity: config.gravity ?? velora?.gravity,
      groundPlaneHeight: config.groundPlaneHeight ?? velora?.groundPlaneHeight,
    })

    if (config.collider) {
      this.collider = config.collider
    }

    this.syncParent = config.syncParent ?? true

    // Initial sync from parent position
    const worldPos = this.transform.getWorldPosition()
    this._rigidBody.position = worldPos

    this.track(
      catalyst.signals.onUpdate.subscribe((data) => {
        this.onRender?.(data.deltaTime)
      })
    )
  }

  /**
   * Get the collider.
   */
  public get collider(): Collider | null {
    return this._collider
  }

  public get signals(): Record<string, Signal<any>> {
    return { ...this._signals, ...this._rigidBody?.signals }
  }

  /**
   * Set the collider.
   */
  public set collider(collider: Collider) {
    this.clearCollider()

    this.addNode(collider, RigidBody.COLLIDER_KEY)
    this._collider = collider
    this._rigidBody.collider = collider.collider
  }

  /**
   * Remove the current collider.
   */
  public clearCollider(): void {
    if (this._collider) {
      this.removeNode(RigidBody.COLLIDER_KEY)
      this._collider = null
      this._rigidBody.collider = null
    }
  }

  /**
   * Get velocity.
   */
  public get velocity(): THREE.Vector3 {
    return this._rigidBody.velocity
  }

  /**
   * Set velocity.
   */
  public set velocity(value: THREE.Vector3) {
    this._rigidBody.velocity = value
  }

  /**
   * Get vertical velocity.
   */
  public get verticalVelocity(): number {
    return this._rigidBody.verticalVelocity
  }

  /**
   * Set vertical velocity.
   */
  public set verticalVelocity(value: number) {
    this._rigidBody.verticalVelocity = value
  }

  /**
   * Check if grounded.
   */
  public get isGrounded(): boolean {
    return this._rigidBody.isGrounded
  }

  /**
   * Set grounded state.
   */
  public setGrounded(grounded: boolean): void {
    this._rigidBody.setGrounded(grounded)
  }

  /**
   * Apply force to rigid body.
   */
  public applyForce(force: THREE.Vector3): void {
    this._rigidBody.applyForce(force)
  }

  /**
   * Apply impulse to rigid body.
   */
  public applyImpulse(impulse: THREE.Vector3): void {
    this._rigidBody.applyImpulse(impulse)
  }

  /**
   * Log physics state for debugging.
   */
  public logPhysicsState(label: string = ""): void {
    this._rigidBody.logPhysicsState(`[RigidBody] ${label}`)
  }

  public sync(): void {
    this._rigidBody.position = this.transform.getWorldPosition()
    this._rigidBody.rotation = this.transform.getWorldRotation()
  }

  /**
   * Sync rigid body position with node transform each frame.
   * Position must be accessed via transform.
   */
  protected override onDispose(): void {
    this._rigidBody.dispose()
  }

  public onRender(_deltaTime: number): void {
    if (this.syncParent && this.parent) {
      const parent = this.parent as Node3D
      parent.transform.position.copy(this._rigidBody.position)
      parent.transform.rotation = this._rigidBody.rotation
    } else {
      // Sync Velora body with node's world transform
      this.sync()
    }
  }
}
