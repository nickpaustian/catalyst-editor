import * as THREE from "three"
import { Collider } from "./Collider"

interface CapsuleColliderConfig {
  radius?: number
  height?: number
  visualise?: boolean
}

/**
 * A capsule collider.
 * Holds capsule geometry but has no collision logic yet.
 */
export class CapsuleCollider extends Collider {
  private _radius: number
  private _height: number

  constructor(config: CapsuleColliderConfig = {}) {
    super()
    this._radius = config.radius ?? 0.3
    this._height = config.height ?? 1.8

    // Create capsule geometry
    const capsuleGeometry = new THREE.CapsuleGeometry(
      this._radius,
      this._height - this._radius * 2,
      4,
      8
    )
    this._geometry = capsuleGeometry
    this.calculateBoundingBox()

    // Create visualisation mesh
    const capsuleMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    })
    this._mesh = new THREE.Mesh(capsuleGeometry.clone(), capsuleMaterial)
    this._mesh.position.copy(this._position)
    this.isVisualised = config.visualise ?? false
  }

  /**
   * Get the bottom point of the capsule (for ground detection).
   */
  public get bottomPoint(): THREE.Vector3 {
    return this._position.clone().sub(new THREE.Vector3(0, this._height / 2, 0))
  }

  /**
   * Get the middle point of the capsule (for raycasting).
   */
  public get middlePoint(): THREE.Vector3 {
    return this._position.clone()
  }

  /**
   * Get the radius of the capsule.
   */

  public get radius(): number {
    return this._radius
  }

  public set radius(radius: number) {
    this._radius = radius
    this.rebuildGeometry()
  }

  public get height(): number {
    return this._height
  }

  public set height(height: number) {
    this._height = height
    this.rebuildGeometry()
  }

  private rebuildGeometry(): void {
    this._geometry?.dispose()
    this._geometry = new THREE.CapsuleGeometry(
      this._radius,
      this._height - this._radius * 2,
      4,
      8
    )
    if (this._mesh) {
      this._mesh.geometry.dispose()
      this._mesh.geometry = this._geometry.clone()
    }
    this.needsUpdate()
  }

  /**
   * Check collision
   */
  // public checkCollision(
  //   movement: THREE.Vector3,
  //   colliders: Collider[]
  // ): CollisionResult {
  //   const myBoundingBox = this.boundingBox
  //
  //   colliders.forEach((other) => {
  //     const otherBoundingBox = other.boundingBox
  //
  //     if (Collider.checkBoundingBoxCollision(myBoundingBox, otherBoundingBox)) {
  //       console.log(
  //         `Collision detected between ${this.constructor.name} and ${other.constructor.name}`
  //       )
  //     }
  //   })
  //
  //   return {
  //     adjustedMovement: movement,
  //     isGrounded: false,
  //   }
  // }
}
