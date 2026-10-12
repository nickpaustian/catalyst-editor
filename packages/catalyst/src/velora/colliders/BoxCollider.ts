import * as THREE from "three"
import { Collider } from "./Collider"
import { VeloraEnvironment } from "../VeloraEnvironment"

interface BoxColliderConfig {
  width?: number
  height?: number
  depth?: number
  visualise?: boolean
}

/**
 * A box collider.
 * Holds box geometry but has no collision logic yet.
 */
export class BoxCollider extends Collider {
  private _width: number
  private _height: number
  private _depth: number

  constructor(config: BoxColliderConfig = {}) {
    super()
    this._width = config.width ?? 1
    this._height = config.height ?? 1
    this._depth = config.depth ?? 1

    // Create box geometry
    const boxGeometry = new THREE.BoxGeometry(
      this._width,
      this._height,
      this._depth
    )
    this._geometry = boxGeometry
    this.calculateBoundingBox()

    // Create visualisation mesh
    const veloraEnv = VeloraEnvironment.getInstance()
    const boxMaterial = new THREE.MeshBasicMaterial({
      color: veloraEnv.debugWireframeColour,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    })
    this._mesh = new THREE.Mesh(boxGeometry.clone(), boxMaterial)
    this._mesh.position.copy(this._position)
    this.isVisualised = config.visualise ?? false
  }

  /**
   * Get the bottom point of the box (for ground detection).
   */
  public get bottomPoint(): THREE.Vector3 {
    return this._position.clone().sub(new THREE.Vector3(0, this._height / 2, 0))
  }

  /**
   * Get the middle point of the box (for raycasting).
   */
  public get middlePoint(): THREE.Vector3 {
    return this._position.clone()
  }

  /**
   * Get the width of the box.
   */
  public get width(): number {
    return this._width
  }

  public get height(): number {
    return this._height
  }

  public get depth(): number {
    return this._depth
  }
}
