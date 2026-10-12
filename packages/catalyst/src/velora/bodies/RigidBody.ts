import * as THREE from "three"
import { VeloraEnvironment } from "../VeloraEnvironment"
import { Collider, type ColliderSignals } from "../colliders/Collider"
import { Signal } from "@vitrine/catalyst/signals"

interface RigidBodyConfig {
  mass?: number
  drag?: number
  angularDrag?: number
  useGravity?: boolean
  gravity?: number
  groundPlaneHeight?: number | null
}

export interface VelocityData {
  velocity: THREE.Vector3
  rigidBody: RigidBody
}

export interface TransformSignals {
  onMove: Signal<VelocityData>
}

type RigidBodySignals = ColliderSignals & TransformSignals

/**
 * A lightweight rigid body for basic physics simulation.
 * Uses VeloraEnvironment global settings by default, but can be overridden per-body.
 * Accumulates forces, applies gravity and drag, and integrates velocity and position.
 */
export class RigidBody {
  // Public properties with direct access
  public position: THREE.Vector3
  private _rotation: THREE.Quaternion = new THREE.Quaternion()
  public mass: number
  public drag: number

  // Private state
  private _velocity: THREE.Vector3
  private _angularVelocity: THREE.Vector3 = new THREE.Vector3()
  private _acceleration: THREE.Vector3
  private _forces: THREE.Vector3
  private _isGrounded: boolean = false
  private _angularDrag: number
  private _useGravity: boolean
  private _gravity: number
  private _groundPlaneHeight: number | null
  private _collider: Collider | null = null
  private _previousFrameTriggers: Set<Collider> = new Set()
  private _signals: TransformSignals = {
    onMove: new Signal<VelocityData>(),
  }

  constructor(
    initialPosition: THREE.Vector3 = new THREE.Vector3(),
    config: RigidBodyConfig = {}
  ) {
    this.position = initialPosition.clone()
    this._velocity = new THREE.Vector3()
    this._acceleration = new THREE.Vector3()
    this._forces = new THREE.Vector3()

    const velora = VeloraEnvironment.getInstance()

    velora.registerBody(this)

    this.mass = config.mass ?? 1.0
    this.drag = config.drag ?? velora.drag
    this._angularDrag = config.angularDrag ?? 0.99
    this._useGravity = config.useGravity ?? true
    this._gravity = config.gravity ?? velora.gravity
    this._groundPlaneHeight =
      config.groundPlaneHeight ?? velora.groundPlaneHeight
  }

  /**
   * Apply a force to this rigid body (accumulated for this frame).
   */
  public applyForce(force: THREE.Vector3): void {
    this._forces.add(force)
  }

  /**
   * Apply an instantaneous velocity change.
   */
  public applyImpulse(impulse: THREE.Vector3): void {
    this._velocity.add(impulse.clone().divideScalar(this.mass))
  }

  /**
   * Get ground plane height. Set to null to disable.
   */
  public get groundPlaneHeight(): number | null {
    return this._groundPlaneHeight
  }

  /**
   * Set ground plane height. Set to null to disable.
   */
  public set groundPlaneHeight(value: number | null) {
    this._groundPlaneHeight = value
  }

  public get signals(): RigidBodySignals | null {
    if (!this._collider) return null
    return { ...this._collider.signals, ...this._signals }
  }

  /**
   * Set the collider for this rigid body.
   * Needed for collision detection and proper ground plane positioning.
   */
  public set collider(value: any) {
    this._collider = value
  }

  public get rotation(): THREE.Quaternion {
    return this._rotation.clone()
  }

  public set rotation(value: THREE.Quaternion) {
    this._rotation.copy(value)
  }

  public get angularVelocity(): THREE.Vector3 {
    return this._angularVelocity.clone()
  }

  public set angularVelocity(value: THREE.Vector3) {
    this._angularVelocity.copy(value)
  }

  /**
   * Integrate forces and velocity, updating position.
   * This should be called once per frame.
   */
  public integrate(deltaSeconds: number): void {
    if (!this._collider) return

    // Calculate acceleration from forces: a = F / m
    this._acceleration.copy(this._forces).divideScalar(this.mass)

    // Apply gravity separately if enabled
    if (this._useGravity) {
      this._acceleration.y -= this._gravity
    }

    // Update velocity from acceleration: v += a * dt
    this._velocity.add(this._acceleration.clone().multiplyScalar(deltaSeconds))

    // Apply drag (resistance)
    this._velocity.multiplyScalar(Math.pow(1 - this.drag, deltaSeconds))

    const integratedVelocity = this._velocity
      .clone()
      .multiplyScalar(deltaSeconds)

    // Update position from velocity: p += v * dt
    this.position.add(integratedVelocity)

    // Apply safety floor (ground plane height) - only when falling and below the floor
    if (this._groundPlaneHeight !== null && this._velocity.y < 0) {
      // Get collider height to properly position above ground

      const targetY = this._groundPlaneHeight + this._collider.height / 2

      // Only clamp if we've gone below the floor
      if (this.position.y < targetY) {
        this.position.y = targetY
        this._velocity.y = 0
        integratedVelocity.y = 0
      }
    }

    if (this._velocity.length()) {
      if (!this.signals) return

      const signals = this.signals
      signals.onMove.emit({ velocity: integratedVelocity, rigidBody: this })
    }

    // Apply angular drag
    this._angularVelocity.multiplyScalar(
      Math.pow(1 - this._angularDrag, deltaSeconds)
    )

    // Update rotation from angular velocity
    const deltaRotation = new THREE.Quaternion().setFromAxisAngle(
      this._angularVelocity.clone().normalize(),
      this._angularVelocity.length() * deltaSeconds
    )
    this._rotation.multiplyQuaternions(deltaRotation, this._rotation)

    // Reset forces for next frame
    this._forces.set(0, 0, 0)
  }

  /**
   * Clamp velocity to maximum speed on horizontal plane.
   * Useful for capping movement speed without affecting vertical movement.
   */
  public clampHorizontalVelocity(maxSpeed: number): void {
    const horizontalVelocity = new THREE.Vector3(
      this._velocity.x,
      0,
      this._velocity.z
    )
    const currentSpeed = horizontalVelocity.length()

    if (currentSpeed > maxSpeed) {
      horizontalVelocity.normalize().multiplyScalar(maxSpeed)
      this._velocity.x = horizontalVelocity.x
      this._velocity.z = horizontalVelocity.z
    }
  }

  /**
   * Clamp velocity on all axes.
   */
  public clampVelocity(maxSpeed: number): void {
    if (this._velocity.length() > maxSpeed) {
      this._velocity.normalize().multiplyScalar(maxSpeed)
    }
  }

  /**
   * Dampen vertical velocity only.
   */
  public dampenVertical(damping: number): void {
    this._velocity.y *= damping
  }

  /**
   * Get current velocity.
   */
  public get velocity(): THREE.Vector3 {
    return this._velocity.clone()
  }

  /**
   * Set velocity directly.
   */
  public set velocity(value: THREE.Vector3) {
    this._velocity.copy(value)
  }

  /**
   * Get horizontal velocity.
   */
  public get horizontalVelocity(): THREE.Vector3 {
    return new THREE.Vector3(this._velocity.x, 0, this._velocity.z)
  }

  /**
   * Get just the vertical component of velocity.
   */
  public get verticalVelocity(): number {
    return this._velocity.y
  }

  /**
   * Set just the vertical component of velocity.
   * Used for jumping and other discrete velocity changes.
   */
  public set verticalVelocity(value: number) {
    this._velocity.y = value
  }

  /**
   * Check if body is grounded (read-only).
   * Use setGrounded() internally from collision detection.
   */
  public get isGrounded(): boolean {
    return this._isGrounded
  }

  /**
   * Set grounded state.
   * @internal
   */
  public setGrounded(grounded: boolean): void {
    this._isGrounded = grounded
  }

  /**
   * Reset velocity to zero.
   */
  public resetVelocity(): void {
    this._velocity.set(0, 0, 0)
  }

  /**
   * Get current forces.
   */
  public get forces(): THREE.Vector3 {
    return this._forces.clone()
  }

  /**
   * Get current acceleration.
   */
  public get acceleration(): THREE.Vector3 {
    return this._acceleration.clone()
  }

  /**
   * Update the rigid body with collision detection.
   * Called once per physics frame.
   */
  public update(deltaTime: number, colliders: any[]): void {
    if (!this._collider || !this._collider.enabled) return

    const previousPosition = this.position.clone()

    // Calculate what the movement WOULD be
    this.integrate(deltaTime)
    const predictedMovement = this.position.clone().sub(previousPosition)

    // Check collision on predicted movement
    let adjustedMovement: THREE.Vector3 = predictedMovement
    let isGrounded: boolean = false
    let triggerColliders: Collider[] = []

    if (this._collider && colliders.length > 0) {
      const otherColliders = colliders.filter((c: any) => c !== this._collider)
      if (otherColliders.length > 0) {
        const collisionResults = this._collider.checkCollision(
          predictedMovement,
          otherColliders
        )
        adjustedMovement = collisionResults.adjustedMovement
        isGrounded = collisionResults.isGrounded
        triggerColliders = collisionResults.triggerColliders ?? []
      }
    }

    // Apply adjusted movement
    this.position.copy(previousPosition).add(adjustedMovement)
    this._collider.position = this.position

    // Check ground plane if not already grounded
    if (
      !isGrounded &&
      this._groundPlaneHeight !== null &&
      this._velocity.y <= 0
    ) {
      const targetY = this._groundPlaneHeight + this._collider.height / 2
      if (Math.abs(this.position.y - targetY) < 0.01) {
        isGrounded = true
      }
    }

    this.setGrounded(isGrounded)

    this.processTriggers(triggerColliders)
  }

  private processTriggers(currentTriggers: Collider[]): void {
    const currentSet = new Set(currentTriggers)

    const collider = this._collider
    if (!this.signals || !collider) return

    const signals = this.signals

    currentSet.forEach((trigger) => {
      const wasActive = this._previousFrameTriggers.has(trigger)

      if (!wasActive) {
        // Enter
        signals.onTriggerEnter.emit({ other: trigger })
        trigger.signals.onTriggerEnter.emit({ other: collider })
      } else {
        // Stay
        signals.onTriggerStay.emit({ other: trigger })
        trigger.signals.onTriggerStay.emit({ other: collider })
      }
    })

    // Exit
    this._previousFrameTriggers.forEach((trigger) => {
      if (!currentSet.has(trigger)) {
        signals.onTriggerExit.emit({ other: trigger })
        trigger.signals.onTriggerExit.emit({ other: collider })
      }
    })

    this._previousFrameTriggers = currentSet
  }

  /**
   * Cleanup and unregister this rigid body.
   */
  public dispose(): void {
    VeloraEnvironment.getInstance().unregisterBody(this)
    this._collider?.dispose()
  }

  /**
   * Log physics state for debugging.
   */
  public logPhysicsState(label: string = ""): void {
    console.group(`RigidBody Physics State ${label}`)
    console.log("Position:", this.position)
    console.log("Velocity:", this.velocity)
    console.log("Acceleration:", this.acceleration)
    console.log("Forces:", this.forces)
    console.log("Mass:", this.mass)
    console.log("Drag:", this.drag)
    console.log("Is Grounded:", this.isGrounded)
    console.log("Ground Plane Height:", this._groundPlaneHeight)
    console.groupEnd()
  }
}
