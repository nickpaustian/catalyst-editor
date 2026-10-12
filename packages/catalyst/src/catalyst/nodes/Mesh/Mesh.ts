import * as THREE from "three"
import { Node3D } from "../Node3D"
import { Catalyst } from "../../core"

/**
 * Mesh - Base class for 3D mesh nodes.
 * Provides mesh management and transform syncing.
 */
export abstract class Mesh extends Node3D {
  protected _mesh: THREE.Mesh | null = null

  constructor(name: string = "meshNode") {
    super(name)

    this.track(
      Catalyst._.signals.onRender.subscribe((data) => {
        this.onRender(data.deltaTime)
      })
    )
  }

  //=========================
  // Getters & Setters
  //=========================

  public get mesh(): THREE.Mesh | null {
    return this._mesh
  }

  /**
   * Set the material.
   */
  public set material(material: THREE.Material) {
    if (!this?._mesh) return
    this._mesh.material = material
  }

  public get material(): THREE.Material | THREE.Material[] | null {
    return this.mesh?.material ?? null
  }

  /**
   * Sync collider position with node transform each frame.
   */
  public onRender(_deltaTime: number): void {
    if (!this?._mesh) return

    this._mesh.position.copy(this.transform.getWorldPosition())
    this._mesh.quaternion.copy(this.transform.getWorldRotation())
    // this._collider.scale = this.transform.getWorldScale()
  }

  protected override onDispose(): void {
    if (!this._mesh) return
    this._mesh.parent?.remove(this._mesh)
    this._mesh.geometry.dispose()
    const materials = Array.isArray(this._mesh.material)
      ? this._mesh.material
      : [this._mesh.material]
    materials.forEach((material) => material.dispose())
    this._mesh = null
  }
}
