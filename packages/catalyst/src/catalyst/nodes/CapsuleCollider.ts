import * as THREE from "three"
import { Collider, type ColliderConfig } from "./Collider"
import type { ExposedProperty } from "./exposed"
import { CapsuleCollider as VeloraCapsuleCollider } from "@vitrine/catalyst/velora/colliders/CapsuleCollider"

export interface CapsuleColliderConfig extends ColliderConfig {
  radius?: number
  height?: number
}

/**
 * CapsuleCollider - A node wrapper for Velora's CapsuleCollider.
 */
export class CapsuleCollider extends Collider<CapsuleColliderConfig> {
  static exposed: ExposedProperty[] = [
    { key: "radius", type: "number", min: 0.01, step: 0.05 },
    { key: "height", type: "number", min: 0.01, step: 0.1 },
  ]

  protected declare _collider: VeloraCapsuleCollider

  constructor(config: CapsuleColliderConfig = {}) {
    super({
      ...config,
      name: config.name ?? "capsuleCollider",
    })
  }

  //=========================
  // Setup
  //=========================

  protected createCollider(): void {
    this._collider = new VeloraCapsuleCollider({
      radius: this._config.radius,
      height: this._config.height,
      visualise: this._config.visualise,
    })
  }

  /**
   * Get the radius of the capsule.
   */
  public get radius(): number {
    return this._collider.radius
  }

  public set radius(radius: number) {
    this._collider.radius = radius
  }

  /**
   * Get the height of the capsule.
   */
  public get height(): number {
    return this._collider.height
  }

  public set height(height: number) {
    this._collider.height = height
  }

  /**
   * Get the middle point of the capsule.
   */
  public get middlePoint(): THREE.Vector3 {
    return this._collider.middlePoint
  }
}
