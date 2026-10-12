import * as THREE from "three"
import { Catalyst } from "../core"
import { Node } from "./Node"
import { Transform3D } from "./Transform3D"

export class Debug extends Node {
  private _transform: Transform3D
  private debugShape: THREE.Object3D | null = null
  private _visible: boolean = true

  constructor(name: string = "debugNode") {
    super(name)

    this._transform = new Transform3D("transform")
    super.addNode(this._transform, "transform")

    this.track(
      Catalyst._.signals.onRender.subscribe((data) => {
        this.onRender(data.deltaTime)
      })
    )
  }

  /**
   * Get the transform node.
   */
  public get transform(): Transform3D {
    return this._transform
  }

  /**
   * Set the debug shape for this node.
   * The shape will sync its transform to this node's transform each frame.
   */
  public setDebugShape(shape: THREE.Object3D): void {
    // Remove old shape from scene
    if (this.debugShape && this.debugShape.parent) {
      this.debugShape.parent.remove(this.debugShape)
    }

    this.debugShape = shape
    Catalyst._.scene.add(shape)
  }

  /**
   * Update debug shape position and rotation each frame.
   */
  public onRender(deltaTime: number): void {
    if (!this._visible) return

    if (this.debugShape) {
      this.debugShape.position.copy(this.transform.getWorldPosition())
      this.debugShape.quaternion.copy(this.transform.getWorldRotation())
      this.debugShape.scale.copy(this.transform.getWorldScale())
    }

    super.onRender?.(deltaTime)
  }

  /**
   * Toggle debug shape visibility.
   */
  public set visible(enabled: boolean) {
    this._visible = enabled
    if (this.debugShape) {
      this.debugShape.visible = enabled
    }
  }

  public get visible(): boolean {
    return this._visible
  }

  /**
   * Remove the debug shape.
   */
  public clearDebugShape(): void {
    if (this.debugShape && this.debugShape.parent) {
      this.debugShape.parent.remove(this.debugShape)
    }
    this.debugShape = null
  }

  protected override onDispose(): void {
    const shape = this.debugShape
    this.clearDebugShape()
    shape?.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]
      materials.forEach((material) => material?.dispose())
    })
  }
}
