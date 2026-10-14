import * as THREE from "three"
import { Catalyst } from "../core"
import { Node3D } from "./Node3D"
import {
  Collider as VeloraCollider,
  type RaycastIntersection,
} from "@vitrine/catalyst/velora/colliders/Collider"
import { type PhysicsLayer, PhysicsLayerSet } from "@vitrine/catalyst/velora/utils"
import type { ExposedProperty } from "./exposed"

export interface ColliderConfig {
  name?: string
  visualise?: boolean
}

/**
 * Collider - Base class for all collider nodes.
 */
export abstract class Collider<
  T extends ColliderConfig = ColliderConfig
> extends Node3D {
  static exposed: ExposedProperty[] = [
    { key: "isTrigger", label: "Trigger", type: "boolean", save: "properties" },
  ]

  protected _collider!: VeloraCollider
  protected _config: T
  private _initialised: boolean = false
  private _willBeEnabled: boolean = true

  constructor(config: T = {} as T) {
    super({
      ...config,
      name: config.name ?? "collider",
    })
    this._config = config

    this.createCollider()

    this.finaliseCollider()
  }

  //=========================
  // Setup
  //=========================

  protected abstract createCollider(): void

  private finaliseCollider(): void {
    if (this._collider) {
      this._collider.enabled = false
      this._collider.parentNode = this
    }
    this.attachColliderSignals()

    // Subscribe to render updates to sync collider position
    this.track(
      Catalyst._.signals.onRender.subscribe((data) => {
        this.onRender?.(data.deltaTime)
      })
    )

    if (this._visualised) {
      this.createVisualisation()
    }
  }

  //=========================
  // Getters & Setters
  //=========================

  /**
   * Fallback access to the underlaying Velora collider.
   */

  public get collider(): VeloraCollider {
    return this._collider
  }

  public get enabled(): boolean {
    if (!this._initialised) return this._willBeEnabled

    return this._collider.enabled
  }

  public set enabled(enabled: boolean) {
    if (!this._initialised) {
      this._willBeEnabled = enabled
      return
    }

    this._collider.enabled = enabled
  }

  public get isTrigger(): boolean {
    return this._collider.isTrigger
  }

  public set isTrigger(isTrigger: boolean) {
    this._collider.isTrigger = isTrigger
  }

  public get layers(): PhysicsLayerSet {
    return this._collider.layers
  }

  public set layers(layers: PhysicsLayer | PhysicsLayer[]) {
    this._collider.layers = layers
  }

  public get collidesWith(): PhysicsLayerSet {
    return this._collider.collidesWith
  }

  public set collidesWith(collidesWith: PhysicsLayer | PhysicsLayer[]) {
    this._collider.collidesWith = collidesWith
  }

  public get position(): THREE.Vector3 {
    return this._collider.position
  }

  public set position(position: THREE.Vector3) {
    this._collider.position = position
  }

  public get rotation(): THREE.Quaternion | THREE.Euler {
    return this._collider.rotation
  }

  public set rotation(rotation: THREE.Quaternion | THREE.Euler) {
    this._collider.rotation = rotation
  }

  public get height(): number {
    return this._collider.height
  }

  public get geometry(): THREE.BufferGeometry | null {
    return this._collider.geometry
  }

  public get boundingBox(): THREE.Box3 {
    return this._collider.boundingBox
  }

  public get bottomPoint(): THREE.Vector3 {
    return this._collider.bottomPoint
  }

  public get mesh(): THREE.Mesh | null {
    return this._collider.mesh
  }

  public set isVisualised(enabled: boolean) {
    this._collider.isVisualised = enabled
  }

  public get isVisualised(): boolean {
    return this._collider.isVisualised
  }

  public setScene(scene: THREE.Scene | null): void {
    this._collider.setScene(scene)
  }

  public needsUpdate(): void {
    this._collider.needsUpdate()
  }

  //=========================
  // Methods
  //=========================

  protected attachColliderSignals(): void {
    if (this._collider) {
      this._signals = {
        ...this._signals,
        ...this._collider.signals,
      }
    }
  }

  /**
   * Check collision with other colliders.
   */
  public checkCollision(
    movement: THREE.Vector3,
    colliders: VeloraCollider[]
  ): any {
    return this._collider.checkCollision(movement, colliders)
  }

  public containsPoint(point: THREE.Vector3): boolean {
    return this._collider.containsPoint(point)
  }

  /**
   * Raycast against this collider's geometry.
   */
  public raycastGeometry(
    ray: THREE.Ray,
    maxDistance?: number
  ): RaycastIntersection[] | null {
    return this._collider.raycastGeometry(ray, maxDistance)
  }

  protected override onDispose(): void {
    this._collider.dispose()
  }

  /**
   * Sync collider position with node transform each frame.
   */
  public onRender(_deltaTime: number): void {
    this?._collider?.mesh?.layers.enable(9)

    this._collider.position = this.transform.getWorldPosition()
    this._collider.rotation = this.transform.getWorldRotation()
    // this._collider.scale = this.transform.getWorldScale()

    if (!this._initialised) {
      this._initialised = true
      this.enabled = this._willBeEnabled
    }
  }
}
