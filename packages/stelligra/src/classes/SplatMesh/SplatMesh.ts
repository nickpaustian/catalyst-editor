import * as THREE from "three"
import type { GaussianSplatData } from "../../types"

/**
 * Minimal structural interface so SplatMesh can call renderer.remove(this)
 * in dispose() without creating a circular import.
 */
interface ISplatRenderer {
  remove(mesh: SplatMesh): void
}

/**
 * Lightweight data holder for a single set of Gaussian splat data.
 *
 * A `SplatMesh` does NOT own any GPU resources or workers — those live in
 * `SplatRenderer`. Set `position` / `rotation` / `scale` as desired, then
 * call `renderer.add(mesh)` to bake the world-space transform and register
 * the splats with the renderer.
 */
export class SplatMesh extends THREE.Object3D {
  private _data: GaussianSplatData
  /** Back-reference set by SplatRenderer on add() / cleared on remove(). */
  _renderer: ISplatRenderer | null = null

  constructor(data: GaussianSplatData) {
    super()
    this._data = data
    this.frustumCulled = false
  }

  get data(): GaussianSplatData { return this._data }
  get splatCount(): number { return this._data.count }
  get isRegistered(): boolean { return this._renderer !== null }

  /**
   * Unregister from the renderer (if registered) and null out the splat data,
   * making it eligible for GC.
   */
  dispose(): void {
    if (this._renderer) {
      this._renderer.remove(this)
    }
    this._data = null!
  }
}
