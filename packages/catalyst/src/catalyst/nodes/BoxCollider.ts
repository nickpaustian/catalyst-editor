import * as THREE from "three"
import { Collider, Debug, type ColliderConfig } from "@vitrine/catalyst"
import { BoxCollider as VeloraBoxCollider } from "@vitrine/catalyst/velora/colliders/BoxCollider"
import { DebugShapes } from "../debug/DebugShapes"

export interface BoxColliderConfig extends ColliderConfig {
  width?: number
  height?: number
  depth?: number
}

/**
 * BoxCollider - A node wrapper for Velora's BoxCollider.
 */
export class BoxCollider extends Collider<BoxColliderConfig> {
  protected declare _collider: VeloraBoxCollider

  constructor(config: BoxColliderConfig = {}) {
    super({
      ...config,
      name: config.name ?? "boxCollider",
    })
  }

  //=========================
  // Setup
  //=========================

  protected createCollider(): void {
    this._collider = new VeloraBoxCollider({
      width: this._config.width,
      height: this._config.height,
      depth: this._config.depth,
    })
  }

  /**
   * Get the width of the box.
   */
  public get width(): number {
    return this?._collider?.width
  }

  /**
   * Get the height of the box.
   */
  public get height(): number {
    return this?._collider?.height
  }

  /**
   * Get the depth of the box.
   */
  public get depth(): number {
    return this?._collider?.depth
  }

  /**
   * Get the middle point of the box.
   */
  public get middlePoint(): THREE.Vector3 {
    return this._collider.middlePoint
  }

  protected override createVisualisation(): void {
    if (!this.width || !this.height || !this.depth) return

    this.visualisation = new Debug("boxDebug")
    this.addNode(this.visualisation)

    const box = DebugShapes.box({
      width: this.width,
      height: this.height,
      depth: this.depth,
    })
    this._wireframe = box
    this.setVisualisationColour(0xff00ff)

    this.visualisation.setDebugShape(box)
  }
}
