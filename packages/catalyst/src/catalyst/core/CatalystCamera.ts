import * as THREE from "three"
import { Catalyst } from "./Catalyst"
import { createCamera } from "../utils/initialisation"
import { Camera } from "../nodes"

export class CatalystCamera {
  private _view: THREE.PerspectiveCamera
  private _target: THREE.Camera | null = null

  // Dirty tracking
  private _lastPosition = new THREE.Vector3()
  private _lastQuat = new THREE.Quaternion()
  private _dirtyFrame = -1
  private _dirtyCache = false

  public positionDelta = 0
  public rotationDelta = 0
  public velocity = new THREE.Vector3()

  constructor(width: number, height: number) {
    this._view = createCamera(width, height)
  }

  /**
   * Get the active camera.
   */
  public get target(): THREE.Camera | null {
    return this._target
  }

  /**
   * Set the active camera to sync from.
   */
  public set target(camera: THREE.Camera | Camera) {
    if (camera instanceof Camera) {
      this._target = camera.view
    } else {
      this._target = camera
    }
  }

  public get isDirty(): boolean {
    const frame = Catalyst._.frameCount
    if (frame === this._dirtyFrame) return this._dirtyCache

    const pos = this._view.position
    const quat = this._view.quaternion

    this.positionDelta = pos.distanceTo(this._lastPosition)
    this.rotationDelta = quat.angleTo(this._lastQuat)
    this.velocity.subVectors(pos, this._lastPosition)

    this._dirtyCache = this.positionDelta > 0.001 || this.rotationDelta > 0.0005
    this._dirtyFrame = frame

    this._lastPosition.copy(pos)
    this._lastQuat.copy(quat)

    return this._dirtyCache
  }

  /**
   * Subscribe to Catalyst's render loop for syncing.
   */
  public subscribeToRenderLoop(): void {
    Catalyst.getInstance().signals.onRender.subscribe(() => {
      this.sync()
    })
  }

  /**
   * Sync view camera from active camera.
   */
  private sync(): void {
    if (this._target) {
      this._view.position.copy(this._target.position)
      this._view.quaternion.copy(this._target.quaternion)

      if (this._target instanceof THREE.PerspectiveCamera) {
        this._view.fov = this._target.fov
        this._view.updateProjectionMatrix()
      }
    }
  }

  public get view(): THREE.PerspectiveCamera {
    return this._view
  }
}
