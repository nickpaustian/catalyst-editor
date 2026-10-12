import * as THREE from "three"
import type { BakedCameraPath, BakedFrame } from "./CameraPathRecorder"
import type { GuidedCamera } from "@vitrine/catalyst"

export class CameraPathPlayer {
  private _frames: BakedFrame[] = []
  private _isLoaded: boolean = false

  public load(data: BakedCameraPath): void {
    this._frames = data.frames
    this._isLoaded = true
  }

  public get isLoaded(): boolean {
    return this._isLoaded
  }

  public apply(t: number, camera: GuidedCamera): void {
    if (!this._isLoaded || this._frames.length === 0) return

    const clamped = Math.max(0, Math.min(1, t))

    // Find the two frames to interpolate between
    let lower = 0
    let upper = this._frames.length - 1

    for (let i = 0; i < this._frames.length - 1; i++) {
      if (this._frames[i].t <= clamped && this._frames[i + 1].t >= clamped) {
        lower = i
        upper = i + 1
        break
      }
    }

    const frameA = this._frames[lower]
    const frameB = this._frames[upper]

    // Calculate interpolation factor between the two frames
    const range = frameB.t - frameA.t
    const alpha = range > 0 ? (clamped - frameA.t) / range : 0

    // Interpolate position
    const pos = new THREE.Vector3(
      frameA.position.x + (frameB.position.x - frameA.position.x) * alpha,
      frameA.position.y + (frameB.position.y - frameA.position.y) * alpha,
      frameA.position.z + (frameB.position.z - frameA.position.z) * alpha,
    )

    // Slerp rotation
    const rotA = new THREE.Quaternion(
      frameA.rotation.x,
      frameA.rotation.y,
      frameA.rotation.z,
      frameA.rotation.w,
    )
    const rotB = new THREE.Quaternion(
      frameB.rotation.x,
      frameB.rotation.y,
      frameB.rotation.z,
      frameB.rotation.w,
    )
    const rot = new THREE.Quaternion().slerpQuaternions(rotA, rotB, alpha)

    camera.transform.position = pos
    camera.transform.rotation = rot
  }
}
