import * as THREE from "three"
import { VeloraEnvironment } from "../VeloraEnvironment"
import {
  obbFromCollider,
  calculateSweptBoxOverlap,
  testOBBvsOBB,
  type OBB,
  PhysicsLayerSet,
  type PhysicsLayer,
} from "../utils"
import { Signal } from "@vitrine/catalyst/signals"
import { Node } from "@vitrine/catalyst"

/**
 * Result from a collision check.
 */
export interface CollisionResult {
  adjustedMovement: THREE.Vector3
  isGrounded: boolean
  triggerColliders?: Collider[]
}

export interface RaycastIntersection {
  point: THREE.Vector3
  distance: number
  collider: Collider
}

export interface ColliderData {
  other: Collider
}

export interface ColliderSignals {
  onTriggerEnter: Signal<ColliderData>
  onTriggerStay: Signal<ColliderData>
  onTriggerExit: Signal<ColliderData>
}

/**
 * Base collider class with geometry-based collision detection.
 */
export abstract class Collider {
  protected _enabled: boolean = true
  protected _isTrigger: boolean = false
  protected _layers: PhysicsLayerSet
  protected _collidesWith: PhysicsLayerSet

  protected _position: THREE.Vector3
  protected _rotation: THREE.Quaternion
  protected _mesh: THREE.Mesh | null
  protected _isVisualised: boolean = false
  protected _parentScene: THREE.Scene | null = null
  protected _geometry: THREE.BufferGeometry | null = null
  protected _boundingBox: THREE.Box3 | null = null
  protected _localBoundingBox: THREE.Box3 | null = null
  protected _boundingBoxDirty: boolean = false
  protected _parentNode: Node | null = null

  public readonly signals: ColliderSignals = {
    onTriggerEnter: new Signal<ColliderData>(),
    onTriggerStay: new Signal<ColliderData>(),
    onTriggerExit: new Signal<ColliderData>(),
  }

  constructor() {
    this._layers = new PhysicsLayerSet(0)
    this._collidesWith = new PhysicsLayerSet()

    this._position = new THREE.Vector3()
    this._rotation = new THREE.Quaternion()
    this._mesh = null
    this._geometry = null

    const veloraEnv = VeloraEnvironment.getInstance()

    if (veloraEnv.defaultScene) {
      this._parentScene = veloraEnv.defaultScene
    }

    veloraEnv.registerCollider(this)
  }

  //=========================
  // Setters & Getters
  //=========================

  public get enabled(): boolean {
    return this._enabled
  }

  public set enabled(enabled: boolean) {
    this._enabled = enabled
  }

  public get isTrigger(): boolean {
    return this._isTrigger
  }

  public set isTrigger(value: boolean) {
    this._isTrigger = value
  }

  public toggleEnabled(): boolean {
    this._enabled = !this._enabled
    return this._enabled
  }

  public get layers(): PhysicsLayerSet {
    return this._layers
  }

  public set layers(layers: PhysicsLayer | PhysicsLayer[]) {
    this._layers.set(layers)
  }

  public get collidesWith(): PhysicsLayerSet {
    return this._collidesWith
  }

  public set collidesWith(layers: PhysicsLayer | PhysicsLayer[]) {
    this._collidesWith.set(layers)
  }

  public set position(value: THREE.Vector3) {
    if (this._position !== value) {
      this._position.copy(value)
      this.needsUpdate()
    }

    if (this._mesh) {
      this._mesh.position.copy(value)
    }
  }

  public get position(): THREE.Vector3 {
    return this._position
  }

  public get parentNode(): Node | null {
    return this._parentNode
  }

  public set parentNode(node: Node) {
    this._parentNode = node
  }

  public set rotation(value: THREE.Quaternion | THREE.Euler) {
    const newQuat =
      value instanceof THREE.Quaternion
        ? value
        : new THREE.Quaternion().setFromEuler(value)

    if (!this._rotation.equals(newQuat)) {
      this._rotation.copy(newQuat)
      this.needsUpdate()
    }
    if (this._mesh) {
      this._mesh.quaternion.copy(this._rotation)
    }
  }

  public get rotation(): THREE.Quaternion {
    return this._rotation.clone()
  }

  public get height(): number {
    return this.boundingBox.getSize(new THREE.Vector3()).y
  }

  public get geometry(): THREE.BufferGeometry | null {
    return this._geometry
  }

  public get boundingBox(): THREE.Box3 {
    if (!this._boundingBox || this._boundingBoxDirty)
      this.calculateBoundingBox()

    return this._boundingBox!.clone().translate(this._position)
  }

  public setScene(scene: THREE.Scene | null): void {
    this._parentScene = scene
  }

  public get localBoundingBox(): THREE.Box3 {
    if (!this._localBoundingBox || this._boundingBoxDirty)
      this.calculateBoundingBox()
    return this._localBoundingBox!
  }

  //=========================
  // Methods
  //=========================

  public needsUpdate(): void {
    this._boundingBoxDirty = true
  }

  public set isVisualised(enabled: boolean) {
    this._isVisualised = enabled

    if (!this._mesh) {
      console.warn(
        "Collider visualisation mesh not created. Create collider with visualise: true."
      )
      return
    }

    if (enabled && this._parentScene) {
      if (!this._parentScene.children.includes(this._mesh)) {
        this._parentScene.add(this._mesh)
      }
    } else if (!enabled && this._parentScene) {
      this._parentScene.remove(this._mesh)
    }
  }

  public get isVisualised(): boolean {
    return this._isVisualised
  }

  public abstract get bottomPoint(): THREE.Vector3

  public get mesh(): THREE.Mesh | null {
    return this._mesh
  }

  public checkCollision(
    movement: THREE.Vector3,
    colliders: Collider[]
  ): CollisionResult {
    let adjustedMovement = movement.clone()
    let isGrounded = false
    const triggerColliders: Collider[] = []

    colliders.forEach((other) => {
      if (other === this) return
      if (!other.enabled) return
      if (!this.shouldCollideWith(other)) return

      // Broad phase
      const sweptOverlap = calculateSweptBoxOverlap(
        this.boundingBox,
        adjustedMovement,
        other.boundingBox
      )

      if (sweptOverlap.x > 0 && sweptOverlap.y > 0 && sweptOverlap.z > 0) {
        // Narrow phase
        const result = other.collideWith(this, adjustedMovement)

        if (other.isTrigger) {
          triggerColliders.push(other)
        } else {
          adjustedMovement = result.adjustedMovement
          if (result.isGrounded) {
            isGrounded = true
          }
        }
      }
    })

    return {
      adjustedMovement,
      isGrounded,
      triggerColliders,
    }
  }

  private shouldCollideWith(other: Collider): boolean {
    if (this.collidesWith.mask === 0) {
      return true
    }
    return other.layers.list.some((layer) => this.collidesWith.has(layer))
  }

  public raycastGeometry(
    ray: THREE.Ray,
    maxDistance?: number
  ): RaycastIntersection[] | null {
    if (!this._geometry) return null

    const positions = this._geometry.attributes.position.array as Float32Array
    const indices = this._geometry.index
      ? (this._geometry.index.array as Uint32Array | Uint16Array)
      : null

    const intersections: RaycastIntersection[] = []

    const tempVec = new THREE.Vector3()
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    const c = new THREE.Vector3()

    const checkIntersection = (intersection: THREE.Vector3 | null) => {
      if (!intersection) return

      const dist = ray.origin.distanceTo(intersection)
      if (dist > 0.001 && (!maxDistance || dist <= maxDistance)) {
        intersections.push({
          point: intersection.clone(),
          distance: dist,
          collider: this,
        })
      }
    }

    if (indices) {
      // Indexed geometry
      for (let i = 0; i < indices.length; i += 3) {
        const idx0 = indices[i] * 3
        const idx1 = indices[i + 1] * 3
        const idx2 = indices[i + 2] * 3

        a.fromArray(positions, idx0)
        b.fromArray(positions, idx1)
        c.fromArray(positions, idx2)

        a.applyQuaternion(this._rotation).add(this._position)
        b.applyQuaternion(this._rotation).add(this._position)
        c.applyQuaternion(this._rotation).add(this._position)

        checkIntersection(ray.intersectTriangle(a, b, c, false, tempVec))
      }
    } else {
      // Non-indexed geometry
      for (let i = 0; i < positions.length; i += 9) {
        a.fromArray(positions, i)
        b.fromArray(positions, i + 3)
        c.fromArray(positions, i + 6)

        a.applyQuaternion(this._rotation).add(this._position)
        b.applyQuaternion(this._rotation).add(this._position)
        c.applyQuaternion(this._rotation).add(this._position)

        checkIntersection(ray.intersectTriangle(a, b, c, false, tempVec))
      }
    }

    if (!intersections.length) return null

    intersections.sort((a, b) => a.distance - b.distance)

    return intersections
  }

  public calculateBoundingBox(): void {
    this._boundingBoxDirty = false

    if (!this._geometry) {
      this._localBoundingBox = new THREE.Box3(
        new THREE.Vector3(-0.5, -0.5, -0.5),
        new THREE.Vector3(0.5, 0.5, 0.5)
      )
    } else {
      this._geometry.computeBoundingBox()
      this._localBoundingBox = this._geometry.boundingBox!.clone()
    }

    const halfExtents = new THREE.Vector3()
    this._localBoundingBox.getSize(halfExtents).multiplyScalar(0.5)

    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(this._rotation)
    const ay = new THREE.Vector3(0, 1, 0).applyQuaternion(this._rotation)
    const az = new THREE.Vector3(0, 0, 1).applyQuaternion(this._rotation)

    const extentX =
      Math.abs(ax.x) * halfExtents.x +
      Math.abs(ay.x) * halfExtents.y +
      Math.abs(az.x) * halfExtents.z
    const extentY =
      Math.abs(ax.y) * halfExtents.x +
      Math.abs(ay.y) * halfExtents.y +
      Math.abs(az.y) * halfExtents.z
    const extentZ =
      Math.abs(ax.z) * halfExtents.x +
      Math.abs(ay.z) * halfExtents.y +
      Math.abs(az.z) * halfExtents.z

    this._boundingBox = new THREE.Box3(
      new THREE.Vector3(-extentX, -extentY, -extentZ),
      new THREE.Vector3(extentX, extentY, extentZ)
    )
  }

  //=========================
  // Collision
  //=========================

  public static checkBoundingBoxCollision(
    box1: THREE.Box3,
    box2: THREE.Box3
  ): boolean {
    return box1.intersectsBox(box2)
  }

  protected collideWith(
    other: Collider,
    movement: THREE.Vector3
  ): CollisionResult {
    return other.collideWithCollider(this, movement)
  }

  protected collideWithCollider(
    other: Collider,
    movement: THREE.Vector3
  ): CollisionResult {
    return this.collideWithBoundingBox(other, movement)
  }

  protected collideWithBoundingBox(
    other: Collider,
    movement: THREE.Vector3
  ): CollisionResult {
    const myOBB = obbFromCollider(this)
    const otherOBB = obbFromCollider(other)

    // Test where we'd end up after full movement
    const movedOBB: OBB = {
      ...myOBB,
      center: myOBB.center.clone().add(movement),
    }

    const satResult = testOBBvsOBB(movedOBB, otherOBB)

    let adjustedMovement = movement.clone()

    if (satResult.colliding) {
      // Push the movement out of the collider along the penetration normal
      adjustedMovement.sub(
        satResult.normal.clone().multiplyScalar(satResult.depth + 0.005)
      )
    }

    let isGrounded = false
    if (satResult.colliding && satResult.normal.y > 0.5) {
      isGrounded = true
    }

    return {
      adjustedMovement,
      isGrounded,
    }
  }

  public containsPoint(point: THREE.Vector3): boolean {
    return this.boundingBox.containsPoint(point)
  }

  public dispose(): void {
    VeloraEnvironment.getInstance().unregisterCollider(this)
    if (this._mesh && this._parentScene) {
      this._parentScene.remove(this._mesh)
    }

    this._geometry?.dispose()
    this._mesh?.geometry.dispose()

    const materials = Array.isArray(this._mesh?.material)
      ? this._mesh.material
      : [this._mesh?.material]
    materials.forEach((material) => material?.dispose())
  }
}
