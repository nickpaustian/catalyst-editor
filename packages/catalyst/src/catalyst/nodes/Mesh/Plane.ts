import * as THREE from "three"
import { Catalyst } from "../../core/Catalyst"
import { Mesh } from "./Mesh"

export interface PlaneConfig {
  name?: string
  width?: number
  height?: number
  material?: THREE.MaterialParameters
}

/**
 * Plane - A flat rectangular mesh node.
 */
export class Plane extends Mesh {
  constructor(config: PlaneConfig = {}) {
    super(config.name ?? "plane")

    const geometry = new THREE.PlaneGeometry(
      config.width ?? 1,
      config.height ?? 1
    )
    const material = new THREE.MeshBasicMaterial(config.material ?? {})
    this._mesh = new THREE.Mesh(geometry, material)

    Catalyst._.scene.add(this._mesh)
  }
}
