import { svgIcon } from "./icon"
import * as THREE from "three"
import { Collider, Debug, type ColliderConfig } from "@vitrine/catalyst"
import type { ExposedProperty } from "./exposed"
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
  static icon = svgIcon(
    '<path d="M8 1.8 14 4.9v6.2L8 14.2 2 11.1V4.9z"/><path d="M2 4.9 8 8l6-3.1M8 8v6.2"/>'
  )

  static exposed: ExposedProperty[] = [
    { key: "width", type: "number", min: 0.01, step: 0.1 },
    { key: "height", type: "number", min: 0.01, step: 0.1 },
    { key: "depth", type: "number", min: 0.01, step: 0.1 },
  ]

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

  public set width(width: number) {
    this._collider.width = width
    this.refreshVisualisation()
  }

  /**
   * Get the height of the box.
   */
  public get height(): number {
    return this?._collider?.height
  }

  public set height(height: number) {
    this._collider.height = height
    this.refreshVisualisation()
  }

  /**
   * Get the depth of the box.
   */
  public get depth(): number {
    return this?._collider?.depth
  }

  public set depth(depth: number) {
    this._collider.depth = depth
    this.refreshVisualisation()
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

  private refreshVisualisation(): void {
    if (!this.visualisation) return
    const previous = this._wireframe as THREE.LineSegments
    const colour = (previous.material as THREE.LineBasicMaterial).color.getHex()
    const box = DebugShapes.box({
      width: this.width,
      height: this.height,
      depth: this.depth,
      color: colour,
    })
    this._wireframe = box
    this.visualisation.setDebugShape(box)
    previous.geometry.dispose()
    ;(previous.material as THREE.Material).dispose()
  }
}
