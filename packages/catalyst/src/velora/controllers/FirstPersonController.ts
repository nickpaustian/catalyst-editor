// Libraries
import * as THREE from "three"
import { PointerLockControls } from "three/examples/jsm/Addons.js"

// Physics
import { RigidBody } from "@vitrine/catalyst/velora/bodies/RigidBody"
import { Collider } from "@vitrine/catalyst/velora/colliders/Collider"
import { CapsuleCollider } from "@vitrine/catalyst/velora/colliders/CapsuleCollider"

// Utils
import { extractAxisRotation } from "../../shared"

interface ControllerConfig {
  // Collider options
  collider?: Collider
  colliderRadius?: number
  colliderHeight?: number

  // Movement options
  moveSpeed?: number
  sprintSpeed?: number
  jumpForce?: number

  // Physics options
  groundPlaneHeight?: number | null
  collisionGeometries?: THREE.BufferGeometry[]
  dragCoefficient?: number
}

/**
 * First-person controller using an external rigid body and collider for physics.
 * Input is applied via method calls, allowing integration with global input handlers.
 * If no collider is provided, creates a default CapsuleCollider with the specified dimensions.
 */
export class FirstPersonController {
  private camera: THREE.PerspectiveCamera
  private controls: PointerLockControls
  private rigidBody: RigidBody
  private collider: Collider
  private collisionGeometries: THREE.BufferGeometry[]

  private moveSpeed: number
  private sprintSpeed: number
  private jumpForce: number

  // Current input state (applied via methods)
  private inputDirection: THREE.Vector3

  constructor(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    config: ControllerConfig = {}
  ) {
    this.camera = camera
    this.controls = new PointerLockControls(camera, renderer.domElement)

    // Create collider (use provided one or create default CapsuleCollider)
    if (config.collider) {
      this.collider = config.collider
    } else {
      this.collider = new CapsuleCollider({
        radius: config.colliderRadius ?? 0.1,
        height: config.colliderHeight ?? 1.6,
        visualise: true,
      })
    }

    // Initialise rigid body with camera position
    this.rigidBody = new RigidBody(camera.position, {
      mass: 1.0,
      drag: config.dragCoefficient ?? 0.1,
      useGravity: true,
      gravity: 9.8,
      groundPlaneHeight: config.groundPlaneHeight,
    })

    // Pass collider to RigidBody so it can account for collider dimensions when clamping to ground
    this.rigidBody.collider = this.collider

    this.moveSpeed = config.moveSpeed ?? 20.0
    this.sprintSpeed = config.sprintSpeed ?? 40.0
    this.jumpForce = config.jumpForce ?? 5.0
    this.collisionGeometries = config.collisionGeometries ?? []

    this.inputDirection = new THREE.Vector3()

    renderer.domElement.addEventListener("click", () => {
      this.controls.lock()
    })
  }

  /**
   * Set the movement direction based on input.
   * This should be called by your global input handler.
   * Direction should be normalised or will be normalised here.
   */
  public setMovementDirection(direction: THREE.Vector3): void {
    this.inputDirection.copy(direction)
  }

  /**
   * Apply movement input. Call with movement vector from input system.
   * Uses direct velocity for responsive player control.
   */
  public applyMovementInput(
    forward: boolean,
    backward: boolean,
    left: boolean,
    right: boolean,
    isSprinting: boolean
  ): void {
    // Get forward direction from camera
    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion
    )
    cameraForward.y = 0
    cameraForward.normalize()

    // Get right direction
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(
      this.camera.quaternion
    )
    cameraRight.y = 0
    cameraRight.normalize()

    // Build movement vector
    const moveVector = new THREE.Vector3()
    if (forward) moveVector.add(cameraForward)
    if (backward) moveVector.sub(cameraForward)
    if (right) moveVector.add(cameraRight)
    if (left) moveVector.sub(cameraRight)

    // Normalise
    if (moveVector.lengthSq() > 0) {
      moveVector.normalize()
    }

    // Scale by speed
    const currentSpeed = isSprinting ? this.sprintSpeed : this.moveSpeed
    moveVector.multiplyScalar(currentSpeed)

    // Set desired velocity directly (not force)
    const currentVelocity = this.rigidBody.velocity
    const newVelocity = new THREE.Vector3(
      moveVector.x,
      currentVelocity.y,
      moveVector.z
    )

    this.rigidBody.velocity = newVelocity
  }

  /**
   * Jump if grounded.
   */
  public jump(): void {
    if (!this.rigidBody.isGrounded) return

    this.rigidBody.verticalVelocity = this.jumpForce
    this.rigidBody.setGrounded(false)
  }

  /**
   * Set the position of the controller (camera and collider).
   */
  public setPosition(position: THREE.Vector3): void {
    this.camera.position.copy(position)
    this.rigidBody.position = position
    this.collider.position = position
  }

  /**
   * Get the current position.
   */
  public getPosition(): THREE.Vector3 {
    return this.camera.position.clone()
  }

  /**
   * Get the rigid body
   */
  public getRigidBody(): RigidBody {
    return this.rigidBody
  }

  /**
   * Log current physics state for debugging.
   */
  public logPhysicsState(label: string = ""): void {
    this.rigidBody.logPhysicsState(`[FirstPersonController] ${label}`)
  }

  /**
   * Update the controller. Call once per frame.
   */
  public update(): void {
    if (!this.camera || !this.controls) return

    // Camera follows rigid body position
    this.camera.position.copy(this.rigidBody.position)
    this.collider.position = this.rigidBody.position

    // Update collider around y-axis with camera
    this.collider.rotation = extractAxisRotation(this.camera.quaternion, "Y")
  }

  /**
   * Get the pointer lock controls.
   */
  public getControls(): PointerLockControls {
    return this.controls
  }

  /**
   * Add collision geometry.
   */
  public addCollisionGeometry(geometry: THREE.BufferGeometry): void {
    this.collisionGeometries.push(geometry)
  }

  /**
   * Remove collision geometry.
   */
  public removeCollisionGeometry(geometry: THREE.BufferGeometry): void {
    const index = this.collisionGeometries.indexOf(geometry)
    if (index > -1) {
      this.collisionGeometries.splice(index, 1)
    }
  }

  /**
   * Clear all collision geometry.
   */
  public clearCollisionGeometry(): void {
    this.collisionGeometries = []
  }

  /**
   * Set the scene for collider visualisation. Required to toggle visualisation at runtime.
   */
  public setScene(scene: THREE.Scene): void {
    this.collider.setScene(scene)
  }

  /**
   * Toggle collider visualisation on/off.
   */
  public setColliderVisualisation(enabled: boolean): void {
    this.collider.isVisualised = enabled
  }

  /**
   * Check if collider visualisation is enabled.
   */
  public get colliderVisualised(): boolean {
    return this.collider.isVisualised
  }

  /**
   * Set move speed.
   */
  public setMoveSpeed(speed: number): void {
    this.moveSpeed = Math.max(0, speed)
  }

  /**
   * Set sprint speed.
   */
  public setSprintSpeed(speed: number): void {
    this.sprintSpeed = Math.max(0, speed)
  }
}
