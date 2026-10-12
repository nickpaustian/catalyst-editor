import * as THREE from "three"
import { Catalyst } from "../core"
import { BoxCollider, Camera, RigidBody, type CameraConfig } from "../nodes"
import { FocalPoint } from "./FocalPoint"
import { HistoryList, stripRoll } from "../../shared"
import type { InputForceData } from "@vitrine/catalyst/helm/mapping/InputMapper"
import { clamp } from "../utils"
import type { UpdateSignalData } from "../signals"

export class GuidedCamera extends Camera {
  private focalPoints: FocalPoint[] = []
  private currentTarget: FocalPoint | THREE.Vector3 | null = null
  private positionHistory: HistoryList<THREE.Vector3>

  // Rotation velocity system
  private rotationSpeed: number = 0.25
  private maxRotationSpeed: number = 1
  private rotationAcceleration: number = 0.01
  private currentRotationSpeed: number = 0.0
  private lockThreshold: number = 0.01
  private locked: boolean = false
  private body: RigidBody
  private collider: BoxCollider
  private inputForce: number = 0
  private _paused: boolean = false

  constructor(config: CameraConfig & { focalPoints?: FocalPoint[] } = {}) {
    super(config)
    if (config.focalPoints) {
      this.focalPoints = config.focalPoints
    }

    this.positionHistory = new HistoryList({ maxAge: 2000 })

    this.body = new RigidBody({
      name: "guidedCameraBody",
      useGravity: false,
      syncParent: false,
    })
    this.addNode(this.body)

    this.collider = new BoxCollider({
      name: "guidedCameraCollider",
      visualise: false,
      width: 0.25,
      height: 0.25,
      depth: 0.25,
    })
    this.collider.isTrigger = true

    this.body.collider = this.collider
    // this.body.addNode(this.collider)

    Catalyst._.signals.input.onForceChanged.subscribe(
      (data: InputForceData) => {
        this.inputForce = Math.abs(data.force.y)
      },
    )

    // Update target and rotation each frame
    Catalyst._.signals.onUpdate.subscribe((data: UpdateSignalData) => {
      if (this._paused) return
      console.log("not paused")
      this.updateLookTarget()
      this.updateRotationVelocity(data.deltaTime)
    })
  }

  public set paused(value: boolean) {
    this._paused = value
  }

  public get paused(): boolean {
    return this._paused
  }

  /**
   * Set the points of interest for this camera to look at.
   */
  public setFocalPoints(pois: FocalPoint[]): void {
    this.focalPoints = pois
  }

  /**
   * Find the closest point of interest and set it as target.
   */
  private updateLookTarget(): void {
    const cameraPos = this.transform.getWorldPosition()
    if (!cameraPos) return

    // Add current position to history
    const lastPos =
      this.positionHistory.entries[this.positionHistory.entries.length - 1]
        ?.value
    if (!lastPos || cameraPos.distanceTo(lastPos) > 0.1) {
      this.positionHistory.add(cameraPos.clone())
    }

    if (this.focalPoints.length === 0) return

    let closest = null
    let closestDistance = Infinity

    for (const poi of this.focalPoints) {
      if (!poi.active) continue
      const dist = cameraPos.distanceTo(poi.transform.getWorldPosition())
      if (dist < closestDistance) {
        closest = poi
        closestDistance = dist
      }
    }

    if (!closest) {
      // If we were previously tracking a focal point reset current rot speed
      if (this.currentTarget instanceof FocalPoint) {
        this.currentRotationSpeed = 0.0
      }

      this.locked = false
      this.lookForward(cameraPos, ["y"])
      return
    }

    // Update target if changed
    if (closest !== this.currentTarget) {
      this.locked = false
      this.currentTarget = closest
      this.currentRotationSpeed = 0.0
    }
  }

  private lookForward(
    cameraPos: THREE.Vector3,
    lockAxes?: ("x" | "y" | "z")[],
  ): void {
    // Get average movement direction from history
    const avgPosition = this.positionHistory.average()
    let lookDirection = new THREE.Vector3(0, 0, -1)

    if (avgPosition) {
      lookDirection = cameraPos.clone().sub(avgPosition).normalize()
    }

    // If no significant movement, use camera's current forward
    if (lookDirection.length() < 0.001) {
      lookDirection = new THREE.Vector3(0, 0, -1)
      lookDirection.applyQuaternion(this.transform.getWorldRotation())
    }

    // Lock specified axes toward zero
    if (lockAxes) {
      lockAxes.forEach((axis) => {
        lookDirection[axis] = 0
      })
      lookDirection.normalize()
    }

    const lookDistance = 10
    const lookTarget = cameraPos
      .clone()
      .addScaledVector(lookDirection, lookDistance)

    this.currentTarget = new THREE.Vector3().copy(lookTarget)
  }

  /**
   * Update rotation using velocity-based system with acceleration and damping.
   */
  private updateRotationVelocity(deltaTime: number): void {
    if (!this.currentTarget) return

    const targetRotation = this.getLookAtRotation(this.currentTarget)
    const currentQuat = this.transform.rotation

    if (this.locked) {
      this.transform.rotation = targetRotation
      return
    }

    const dot = currentQuat.dot(targetRotation)
    const adjustedTarget =
      dot < 0
        ? new THREE.Quaternion(
            -targetRotation.x,
            -targetRotation.y,
            -targetRotation.z,
            -targetRotation.w,
          )
        : targetRotation

    const angle = Math.acos(Math.max(-1, Math.min(1, Math.abs(dot)))) * 2

    if (angle < this.lockThreshold) {
      this.transform.rotation = adjustedTarget
      this.locked = true
      return
    }

    this.locked = false

    const dt = deltaTime / 1000

    this.currentRotationSpeed = Math.min(
      this.currentRotationSpeed + this.rotationAcceleration * dt,
      this.rotationSpeed,
    )

    const easeFactor = Math.min(1, angle / 0.5)

    const rotationSpeed = clamp(
      this.currentRotationSpeed * Math.abs(this.inputForce) * easeFactor,
      0,
      this.maxRotationSpeed,
    )

    this.inputForce = 0.0

    const slerpFactor = Math.min(1 - Math.exp(-rotationSpeed * dt), 1)

    const newQuat = new THREE.Quaternion().slerpQuaternions(
      currentQuat,
      adjustedTarget,
      slerpFactor,
    )

    this.transform.rotation = stripRoll(newQuat)
  }

  public snapToTarget(): void {
    if (!this.currentTarget) return

    const targetRotation = this.getLookAtRotation(this.currentTarget)
    this.transform.rotation = targetRotation
    this.locked = true
    this.currentRotationSpeed = 0.0
  }
}
