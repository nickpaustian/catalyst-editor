import * as THREE from "three"
import { Node } from "./Node"
import { createReactiveVector3 } from "../utils"
import { Signal } from "../signals"

/**
 * Transform3D - A spatial transform node.
 *
 * Encapsulates position, rotation, and scale data.
 * Can be added to any Node to give it spatial properties.
 */
export class Transform3D extends Node {
  private _position: THREE.Vector3 = createReactiveVector3(() =>
    this.markDirty()
  )
  public _rotation: THREE.Quaternion = new THREE.Quaternion()
  public _scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1)
  private matrix: THREE.Matrix4 = new THREE.Matrix4()
  private worldMatrix: THREE.Matrix4 = new THREE.Matrix4()
  private isDirty: boolean = true

  constructor(name: string = "transform") {
    super(name)

    this._signals = {
      ...this._signals,
      onTransformChanged: new Signal<{
        position: THREE.Vector3
        rotation: THREE.Quaternion
        scale: THREE.Vector3
      }>(),
    }
  }

  public get position(): THREE.Vector3 {
    return this._position
  }

  public set position(value: THREE.Vector3) {
    this._position.copy(value)
  }

  public get rotation(): THREE.Quaternion {
    return this._rotation.clone()
  }

  public set rotation(value: THREE.Quaternion | THREE.Euler) {
    if (value instanceof THREE.Quaternion) {
      this._rotation.copy(value)
    } else {
      this._rotation.setFromEuler(value)
    }
    this.markDirty()
  }

  public get scale(): THREE.Vector3 {
    return this._scale
  }

  public set scale(value: THREE.Vector3) {
    this._scale.copy(value)
    this.markDirty()
  }

  /**
   * Get the local transformation matrix.
   */
  public getMatrix(): THREE.Matrix4 {
    if (this.isDirty) {
      this.matrix.compose(this._position, this._rotation, this._scale)
      this.isDirty = false
    }
    return this.matrix
  }

  /**
   * Get the world transformation matrix (including parent transforms).
   */
  public getWorldMatrix(): THREE.Matrix4 {
    const transformChain: Transform3D[] = []

    const addToChain = (transform: Transform3D) => {
      if (transformChain[0] !== transform) {
        transformChain.unshift(transform)
      }
    }

    let current: any = this

    while (current) {
      if (current instanceof Transform3D) {
        addToChain(current)
        current = current.parent
      } else if (current.transform instanceof Transform3D) {
        addToChain(current.transform)
        current = current.parent
      } else {
        current = current.parent
      }
    }

    let result = new THREE.Matrix4().identity()
    for (const transform of transformChain) {
      result.multiplyMatrices(result, transform.getMatrix())
    }

    this.worldMatrix.copy(result)
    return this.worldMatrix
  }

  /**
   * Get world position.
   */
  public getWorldPosition(): THREE.Vector3 {
    const worldMatrix = this.getWorldMatrix()
    const worldPos = new THREE.Vector3().setFromMatrixPosition(worldMatrix)
    return worldPos
  }

  /**
   * Get world rotation.
   */
  public getWorldRotation(): THREE.Quaternion {
    const worldMatrix = this.getWorldMatrix()
    return new THREE.Quaternion().setFromRotationMatrix(worldMatrix)
  }

  /**
   * Get world scale.
   */
  public getWorldScale(): THREE.Vector3 {
    const worldMatrix = this.getWorldMatrix()
    const scale = new THREE.Vector3()
    scale.x = new THREE.Vector3().setFromMatrixColumn(worldMatrix, 0).length()
    scale.y = new THREE.Vector3().setFromMatrixColumn(worldMatrix, 1).length()
    scale.z = new THREE.Vector3().setFromMatrixColumn(worldMatrix, 2).length()
    return scale
  }

  /**
   * Get the world matrix of all parent transforms (excluding this transform's local matrix).
   */
  public getParentWorldMatrix(): THREE.Matrix4 {
    let current: any = this.parent

    while (current) {
      if (current instanceof Transform3D && current !== this) {
        return current.getWorldMatrix()
      }
      if (
        current.transform instanceof Transform3D &&
        current.transform !== this
      ) {
        return current.transform.getWorldMatrix()
      }
      current = current.parent
    }

    // No parent transform found, return identity
    return new THREE.Matrix4().identity()
  }

  /**
   * Get the world space position of the parent.
   */
  public getParentWorldPosition(): THREE.Vector3 {
    return new THREE.Vector3().setFromMatrixPosition(
      this.getParentWorldMatrix()
    )
  }

  /**
   * Mark the matrix as dirty (needs recalculation).
   * Called automatically when position, rotation, or scale change.
   */
  public markDirty(): void {
    this.isDirty = true
    this.signals.onTransformChanged.emit({
      position: this._position,
      rotation: this._rotation,
      scale: this._scale,
    })
    this.root.signals.onWorldTransformChanged.emit({})
  }

  /**
   * Reset to identity transform.
   */
  public reset(): this {
    this._position.set(0, 0, 0)
    this._rotation.set(0, 0, 0, 1)
    this._scale.set(1, 1, 1)
    this.markDirty()
    return this
  }
}
