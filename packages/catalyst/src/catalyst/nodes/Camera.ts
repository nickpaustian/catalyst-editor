import { svgIcon } from "./icon"
import * as THREE from "three"
import { Node3D } from "./Node3D"
import { Debug } from "./Debug"
import { Catalyst } from "../core/Catalyst"
import { DebugShapes } from "../debug/DebugShapes"
import type { ResizeSignalData, UpdateSignalData } from "../"

export interface CameraSensor {
  height: number
  size: number
}

export interface FocalLengthConfig {
  current: number
  min: number
  max: number
}

export interface CameraConfig {
  name?: string
  fov?: number
  near?: number
  far?: number
  visualise?: boolean
  focalLength?: Partial<FocalLengthConfig>
  sensor?: Partial<CameraSensor>
}

/**
 * Camera - A spatial node wrapping a Three.js PerspectiveCamera.
 */
export class Camera extends Node3D {
  static icon = svgIcon(
    '<rect x="1.8" y="4.5" width="8.7" height="7"/><path d="m10.5 7 3.7-2v6l-3.7-2z"/>'
  )

  private _view: THREE.PerspectiveCamera
  public syncRotation: boolean = true

  // Focal length for FOV control
  public focalLength: FocalLengthConfig
  private sensor: CameraSensor

  constructor(config: CameraConfig = {}) {
    super({
      name: config?.name ?? "camera",
      visualise: config?.visualise ?? false,
    })

    this._view = new THREE.PerspectiveCamera(
      75,
      Catalyst._.width / Catalyst._.height,
      config.near ?? 0.1,
      config.far ?? 1000
    )

    this.focalLength = {
      current: config.focalLength?.current ?? 75,
      min: config.focalLength?.min ?? 7.55,
      max: config.focalLength?.max ?? 200,
    }

    this.sensor = {
      height: 36,
      size: 36,
      ...config.sensor,
    }

    this.setFocalLength(this.focalLength.current)

    // Subscribe to resize signal to update aspect
    this.track(
      Catalyst._.signals.onResize.subscribe((data: ResizeSignalData) => {
        this.updateAspect(data.width, data.height)
      })
    )

    // Subscribe to render loop to sync transform
    this.track(
      Catalyst._.signals.onRender.subscribe((data: UpdateSignalData) => {
        this.onRender?.(data.deltaTime)
      })
    )
  }

  /**
   * Calculate the local rotation needed to look at a target.
   */
  public getLookAtRotation(
    target?: THREE.Vector3 | THREE.Object3D | Node3D
  ): THREE.Quaternion {
    const savedRotation = this.transform.rotation.clone()

    this.lookAt(target)
    const result = this.transform.rotation.clone()

    this.transform.rotation = savedRotation

    return result
  }

  /**
   * Look at a target position and update transform rotation.
   * @param target Vector3, Object3D, or Node3D to look at. Defaults to origin (0, 0, 0)
   */
  public lookAt(target?: THREE.Vector3 | THREE.Object3D | Node3D): void {
    let targetPos: THREE.Vector3
    if (!target) {
      targetPos = new THREE.Vector3(0, 0, 0)
    } else if (target instanceof THREE.Vector3) {
      targetPos = target
    } else if (target instanceof Node3D) {
      targetPos = target.transform.getWorldPosition()
    } else {
      targetPos = target.position
    }

    const savedViewRotation = this._view.quaternion.clone()

    const worldPos = this.transform.getWorldPosition()
    this._view.position.copy(worldPos)
    this._view.lookAt(targetPos)

    // Get parent's world rotation to convert to local
    const parentWorldRotation = this.transform.getParentWorldMatrix()
    const parentQuat = new THREE.Quaternion().setFromRotationMatrix(
      parentWorldRotation
    )

    // Convert world rotation to local
    const worldQuat = this._view.quaternion.clone()
    const localQuat = parentQuat.invert().multiply(worldQuat)

    this._view.quaternion.copy(savedViewRotation)

    this.transform.rotation = localQuat
  }

  /**
   * Lerp the camera rotation to look at a target over time.
   */
  public lookAtSmooth(
    target: THREE.Vector3 | THREE.Object3D | Node3D,
    duration: number = 1000
  ): void {
    const startQuat = this.transform.rotation.clone()
    const startTime = Date.now()

    // Get target position
    let targetPos: THREE.Vector3
    if (target instanceof THREE.Vector3) {
      targetPos = target
    } else if (target instanceof Node3D) {
      targetPos = target.transform.getWorldPosition()
    } else {
      targetPos = target.position
    }

    // Create a temporary quaternion for the target look direction
    const tempCamera = new THREE.PerspectiveCamera()
    const worldPos = this.transform.getWorldPosition()
    tempCamera.position.copy(worldPos)
    tempCamera.lookAt(targetPos)

    const parentWorldRotation = this.transform.getParentWorldMatrix()
    const parentQuat = new THREE.Quaternion().setFromRotationMatrix(
      parentWorldRotation
    )
    const endQuat = parentQuat.invert().multiply(tempCamera.quaternion.clone())

    // Lerp the quaternion
    const lerp = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)

      const currentQuat = new THREE.Quaternion().slerpQuaternions(
        startQuat,
        endQuat,
        progress
      )
      this.transform.rotation = currentQuat

      if (progress < 1) {
        requestAnimationFrame(lerp)
      }
    }

    lerp()
  }

  /**
   * Calculate FOV from focal length.
   */
  private calculateFOVFromFocalLength(focalLength: number): number {
    const aspect = this._view.aspect
    const sensorSize = this.sensor.size

    // Determine sensor height based on aspect ratio
    const sensorHeight = aspect >= 1 ? sensorSize / aspect : sensorSize

    // Calculate vertical FOV in degrees
    const verticalFOV =
      2 * Math.atan(sensorHeight / (2 * focalLength)) * (180 / Math.PI)

    return verticalFOV
  }

  /**
   * Set focal length and update FOV.
   */
  public setFocalLength(length: number): void {
    this.focalLength.current = Math.max(
      this.focalLength.min,
      Math.min(this.focalLength.max, length)
    )
    const newFOV = this.calculateFOVFromFocalLength(this.focalLength.current)
    if (Math.abs(newFOV - this._view.fov) > 0.05) {
      this._view.fov = newFOV
      this._view.updateProjectionMatrix()
    }
  }

  /**
   * Blend focal length over time.
   */
  public blendFocalLength(targetLength: number, duration: number): void {
    const startLength = this.focalLength.current
    const startTime = Date.now()

    const blend = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const current = THREE.MathUtils.lerp(startLength, targetLength, progress)
      this.setFocalLength(current)

      if (progress < 1) {
        requestAnimationFrame(blend)
      }
    }

    blend()
  }

  /**
   * Sync camera position and rotation from node transform each frame.
   */
  public onRender(_deltaTime: number): void {
    this.syncCamera()
  }

  public syncCamera(): void {
    this._view.position.copy(this.transform.getWorldPosition())
    if (this.syncRotation)
      this._view.quaternion.copy(this.transform.getWorldRotation())
  }

  /**
   * Get the underlying Three.js camera.
   */
  public get view(): THREE.PerspectiveCamera {
    return this._view
  }

  /**
   * Update camera aspect ratio.
   */
  public updateAspect(width: number, height: number): void {
    this._view.aspect = width / height
    this._view.updateProjectionMatrix()
    this.setFocalLength(this.focalLength.current)
  }

  //=========================
  // Debug Visualisation
  //=========================

  /**
   * Create visualisation.
   */
  protected override createVisualisation(): void {
    this.visualisation = new Debug("cameraDebug")
    this.addNode(this.visualisation)
    const colour = 0x00d4d4

    // Main body cube
    const cube = DebugShapes.cube({
      size: 0.2,
      color: colour,
      autoAdd: false,
    })

    cube.position.z = 0.1

    // Rhombus prism (smaller cube tapering forward)
    const rhombus = DebugShapes.customPolyhedron({
      vertices: [
        // Back face
        -0.125, -0.125, 0.5, 0.125, -0.125, 0.5, 0.125, 0.125, 0.5, -0.125,
        0.125, 0.5,
        // Front face
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
      ],
      indices: [
        // Back
        0, 1, 2, 0, 2, 3,
        // Front
        4, 6, 5, 4, 7, 6,
        // Sides
        0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
      ],
      radius: 0.8675,
      color: colour,
      autoAdd: false,
    })

    rhombus.scale.multiplyScalar(0.2)
    rhombus.scale.z = 0.125
    rhombus.position.z = -0.1

    const debugShape = new THREE.Group()
    debugShape.add(cube)
    debugShape.add(rhombus)
    this.visualisation.setDebugShape(debugShape)
  }
}
