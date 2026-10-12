import * as THREE from "three"
import { Catalyst } from "../core/Catalyst"
import { Plane, type PlaneConfig } from "../nodes/"

export interface BillboardConfig extends PlaneConfig {
  targetCamera?: THREE.Camera
}

/**
 * Billboard - A plane that always faces the active camera.
 */
export class Billboard extends Plane {
  private targetCamera?: THREE.Camera

  constructor(config: BillboardConfig = {}) {
    super(config)

    this.targetCamera = config.targetCamera ?? Catalyst._.camera?.view

    // Subscribe to render to update billboard rotation
    this.track(
      Catalyst._.signals.onRender.subscribe(() => {
        this.updateBillboard()
      })
    )
  }

  /**
   * Update billboard to face camera.
   */
  private updateBillboard(): void {
    if (!this._mesh || !this.targetCamera) return
    this._mesh.lookAt(this.targetCamera.position)
  }

  /**
   * Set target camera.
   */
  public setTargetCamera(camera: THREE.Camera): void {
    this.targetCamera = camera
  }
}
