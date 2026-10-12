import type { GuidedCamera } from "@vitrine/catalyst"

export interface BakedFrame {
  t: number
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
}

export interface BakedCameraPath {
  version: number
  frameCount: number
  frames: BakedFrame[]
}

export class CameraPathRecorder {
  private _frames: BakedFrame[] = []

  public captureFrame(t: number, camera: GuidedCamera): void {
    const pos = camera.transform.position
    const rot = camera.transform.rotation

    this._frames.push({
      t,
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
    })
  }

  public export(): BakedCameraPath {
    return {
      version: 1,
      frameCount: this._frames.length,
      frames: this._frames,
    }
  }
}
