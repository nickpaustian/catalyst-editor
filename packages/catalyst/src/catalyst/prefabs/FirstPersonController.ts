import * as THREE from "three"
import { PointerLockControls } from "three/examples/jsm/Addons.js"
import { Catalyst } from "../core/Catalyst"
import { Node3D, RigidBody, CapsuleCollider, Camera, Raycast } from "../nodes"
import { Helm } from "@vitrine/catalyst/helm"
import { extractAxisRotation } from "../../shared"
import type { RaycastIntersection } from "@vitrine/catalyst/velora/colliders/Collider"

interface FirstPersonControllerConfig {
  name?: string
  moveSpeed?: number
  sprintSpeed?: number
  jumpForce?: number
  cameraFOV?: number
  visualise?: boolean
  canLockPointer?: () => boolean
}

/**
 * FirstPersonController node prefab.
 */
export class FirstPersonController extends Node3D {
  public camera: Camera
  public rigidBody: RigidBody
  public raycast: Raycast
  public active: boolean = true

  private moveSpeed: number
  private sprintSpeed: number
  private jumpForce: number

  private _debugMode: boolean = false
  private static readonly ACTIONS = [
    "moveForward",
    "moveBackward",
    "moveLeft",
    "moveRight",
    "jump",
    "sprint",
  ]
  private canLockPointer: () => boolean

  private pointerLockControls: PointerLockControls | null = null

  // Head bob
  private _headBobTimer: number = 0
  private _headBobFrequency: number = 4
  private _headBobVerticalAmount: number = 0.02
  private _headBobHorizontalAmount: number = 0.01
  private _headBobPreviousVertical: number = 0
  private _headBobWasFalling: boolean = false
  private _headBobSmoothing: number = 4
  private _currentBobOffset: THREE.Vector3 = new THREE.Vector3()
  private _targetBobOffset: THREE.Vector3 = new THREE.Vector3()
  private _baseCameraY: number = 0

  // Input state
  private inputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprinting: false,
  }

  constructor(config: FirstPersonControllerConfig = {}) {
    super(config?.name ?? "firstPersonController")

    this.moveSpeed = config.moveSpeed ?? 1.0
    this.canLockPointer = config.canLockPointer ?? (() => true)
    this.sprintSpeed = config.sprintSpeed ?? 2.0
    this.jumpForce = config.jumpForce ?? 3.0

    // Setup RigidBody with CapsuleCollider
    this.rigidBody = new RigidBody({ syncParent: true })
    this.addNode(this.rigidBody)
    this.rigidBody.collider = new CapsuleCollider({
      radius: 0.15,
      height: 1.7,
      visualise: config.visualise ?? false,
    })

    // Setup Camera
    this.camera = new Camera({
      fov: config.cameraFOV ?? 75,
      visualise: config.visualise ?? false,
    })
    this.addNode(this.camera)

    // Position camera at eye level relative to capsule
    this.camera.transform.position.y =
      (this.rigidBody.collider.height / 2) * 0.85

    this._baseCameraY = this.camera.transform.position.y

    // Setup Raycast for interaction
    this.raycast = new Raycast({
      visualise: config.visualise ?? false,
      length: 4,
    })
    this.camera.addNode(this.raycast)
    this.raycast.setDirection(new THREE.Vector3(0, 0, -1))
    this.raycast.layers = 9

    this.track(
      Catalyst._.signals.onUpdate.subscribe(() => {
        this.applyMovement()
      })
    )

    // Subscribe to update loop to apply movement
    this.track(
      Catalyst._.signals.onRender.subscribe((data) => {
        this.applyHeadBob(data.deltaTime)
        this.syncTransformWithPointerLock()
      }, 10)
    )

    this.setupPointerLock()

    // Setup input and logic
    this.setupInput()

    this.camera.setFocalLength(12)
  }

  //=========================
  // Getters & Setters
  //=========================

  public get debugMode(): boolean {
    return this._debugMode
  }

  private setupInput(): void {
    const helm = Helm.getInstance()

    // Bind keys to actions
    helm.bind("moveForward", ["w", "ArrowUp"])
    helm.bind("moveBackward", ["s", "ArrowDown"])
    helm.bind("moveLeft", ["a", "ArrowLeft"])
    helm.bind("moveRight", ["d", "ArrowRight"])
    helm.bind("jump", " ")
    helm.bind("sprint", "Shift")

    // Track input state
    this.track(
      helm.signals.onActionStart.subscribe(({ action }) => {
        this.updateInputState(action, true)
        if (action === "jump") {
          this.jump()
        }
      })
    )

    this.track(
      helm.signals.onActionEnd.subscribe(({ action }) => {
        this.updateInputState(action, false)
      })
    )

    this.track(() => {
      FirstPersonController.ACTIONS.forEach((action) => helm.unbind(action))
    })
  }

  public toggleDebugMode(): void {
    this._debugMode = !this._debugMode

    if (this._debugMode) {
      this.raycast.layers = 1
    } else {
      this.raycast.layers = 9
    }
  }

  private updateInputState(action: string, pressed: boolean): void {
    switch (action) {
      case "moveForward":
        this.inputState.forward = pressed
        break
      case "moveBackward":
        this.inputState.backward = pressed
        break
      case "moveLeft":
        this.inputState.left = pressed
        break
      case "moveRight":
        this.inputState.right = pressed
        break
      case "sprint":
        this.inputState.sprinting = pressed
        break
    }
  }

  private applyMovement(): void {
    // Get forward direction from camera
    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      this.camera.view.quaternion
    )
    cameraForward.y = 0
    cameraForward.normalize()

    // Get right direction
    const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(
      this.camera.view.quaternion
    )
    cameraRight.y = 0
    cameraRight.normalize()

    // Build movement vector
    const moveVector = new THREE.Vector3()
    if (this.inputState.forward) moveVector.add(cameraForward)
    if (this.inputState.backward) moveVector.sub(cameraForward)
    if (this.inputState.right) moveVector.add(cameraRight)
    if (this.inputState.left) moveVector.sub(cameraRight)

    // Normalise
    if (moveVector.lengthSq() > 0) {
      moveVector.normalize()
    }

    // Scale by speed
    const currentSpeed = this.inputState.sprinting
      ? this.sprintSpeed
      : this.moveSpeed
    moveVector.multiplyScalar(currentSpeed)

    // Set velocity directly (preserve vertical velocity)
    const currentVelocity = this.rigidBody.velocity
    const newVelocity = new THREE.Vector3(
      moveVector.x,
      currentVelocity.y,
      moveVector.z
    )

    this.rigidBody.velocity = newVelocity
  }

  private jump(): void {
    return
    if (!this.rigidBody.isGrounded) return
    this.rigidBody.verticalVelocity = this.jumpForce
    this.rigidBody.setGrounded(false)
  }

  public getCamera(): THREE.PerspectiveCamera {
    return this.camera.view
  }

  public setPosition(position: THREE.Vector3): void {
    this.transform.position = position
  }

  public castRaycast(): RaycastIntersection[][] {
    const result = this.raycast.cast()
    return result
  }

  private setupPointerLock(): void {
    this.pointerLockControls = new PointerLockControls(
      this.camera.view,
      document.body
    )

    const onClick = () => {
      if (!this.canLockPointer()) return
      if (this.active) this.enablePointerLock()
    }
    const onPointerLockChange = () => {
      if (document.pointerLockElement) {
        Catalyst._.signals.game.onPointerLockChange.emit({ enabled: true })
      } else {
        Catalyst._.signals.game.onPointerLockChange.emit({ enabled: false })
      }
    }
    document.addEventListener("click", onClick)
    document.addEventListener("pointerlockchange", onPointerLockChange)

    this.track(() => {
      document.removeEventListener("click", onClick)
      document.removeEventListener("pointerlockchange", onPointerLockChange)
      if (document.pointerLockElement) this.pointerLockControls?.unlock()
      this.pointerLockControls?.dispose()
      this.pointerLockControls = null
    })
  }

  private syncTransformWithPointerLock(): void {
    if (!this.pointerLockControls?.isLocked) return

    this.camera.transform.rotation = this.camera.view.quaternion.clone()
    this.rigidBody.transform.rotation = extractAxisRotation(
      this.camera.view.quaternion,
      "Y"
    )
  }

  public squint(): void {
    return
    setTimeout(() => {
      this.camera.blendFocalLength(14, 300)
    }, 150)
    // this.camera.setFocalLength(10)
  }

  public unsquint(): void {
    this.camera.blendFocalLength(12, 300)
  }

  private applyHeadBob(deltaTime: number): void {
    const deltaSeconds = deltaTime / 1000

    // Calculate current horizontal speed
    const velocity = this.rigidBody.velocity
    const horizontalSpeed = new THREE.Vector2(velocity.x, velocity.z).length()

    // Normalise speed against move/sprint speed for intensity
    const maxSpeed = this.sprintSpeed
    const speedFactor = Math.min(horizontalSpeed / maxSpeed, 1)

    if (horizontalSpeed > 0.1) {
      // Scale frequency slightly with sprint
      const freq = this._headBobFrequency * (1 + speedFactor * 0.3)
      this._headBobTimer += deltaSeconds * freq

      const vertical = Math.sin(this._headBobTimer * 2)

      this._targetBobOffset.set(
        Math.cos(this._headBobTimer) *
          this._headBobHorizontalAmount *
          speedFactor,
        Math.sin(this._headBobTimer * 2) *
          this._headBobVerticalAmount *
          speedFactor,
        0
      )

      if (vertical < this._headBobPreviousVertical) {
        this._headBobWasFalling = true
      }

      // Detect trough
      if (this._headBobWasFalling && vertical > this._headBobPreviousVertical) {
        this._headBobWasFalling = false
      }

      this._headBobPreviousVertical = vertical
    } else {
      // Settle back to neutral
      this._headBobTimer = 0
      this._targetBobOffset.set(0, 0, 0)
    }

    const lerpFactor = Math.min(deltaSeconds * this._headBobSmoothing, 1)
    this._currentBobOffset.lerp(this._targetBobOffset, lerpFactor)

    // Apply to camera
    this.camera.transform.position.y =
      this._baseCameraY + this._currentBobOffset.y
    this.camera.transform.position.x = this._currentBobOffset.x
  }

  public enablePointerLock(): void {
    this.camera.syncRotation = false
    this.pointerLockControls?.lock()
  }

  public disablePointerLock(): void {
    this.camera.syncRotation = true
    this.pointerLockControls?.unlock()
  }

  public isPointerLocked(): boolean {
    return this.pointerLockControls?.isLocked ?? false
  }
}
