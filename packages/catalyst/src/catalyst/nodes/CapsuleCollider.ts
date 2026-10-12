import * as THREE from "three"
import { Collider, type ColliderConfig } from "./Collider"
import { CapsuleCollider as VeloraCapsuleCollider } from "@vitrine/catalyst/velora/colliders/CapsuleCollider"

export interface CapsuleColliderConfig extends ColliderConfig {
  radius?: number
  height?: number
}

/**
 * CapsuleCollider - A node wrapper for Velora's CapsuleCollider.
 */
export class CapsuleCollider extends Collider<CapsuleColliderConfig> {
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

  /**
   * Get the height of the capsule.
   */
  public get height(): number {
    return this._collider.height
  }

  /**
   * Get the middle point of the capsule.
   */
  public get middlePoint(): THREE.Vector3 {
    return this._collider.middlePoint
  }
}
