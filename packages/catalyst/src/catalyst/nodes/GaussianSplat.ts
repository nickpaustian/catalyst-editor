import { svgIcon } from "./icon"
import * as THREE from "three"
import { Catalyst } from "../core"
import { Node3D } from "./Node3D"
import { Collider as VeloraCollider } from "@vitrine/catalyst/velora/colliders/Collider"
import { SplatMesh } from "@sparkjsdev/spark"
import { debug } from "@vitrine/debug"

export interface GaussianSplatConfig {
  name?: string
  visualise?: boolean
  position?: THREE.Vector3
  rotation?: THREE.Quaternion | THREE.Vector3
  scale?: number
}

export interface GaussianSplatLod {
  level: number
  url: string
  splatMesh: SplatMesh | null
  isActive: boolean
}

/**
 * Collider - Base class for all collider nodes.
 */
export class GaussianSplat<
  T extends GaussianSplatConfig = GaussianSplatConfig
> extends Node3D {
  static icon = svgIcon(
    '<circle cx="4" cy="5" r="1.4"/><circle cx="9" cy="3.5" r="1.1"/><circle cx="12" cy="7" r="1.6"/><circle cx="6" cy="10" r="1.8"/><circle cx="11" cy="12" r="1.2"/>'
  )

  protected _collider!: VeloraCollider
  protected _config: T
  protected _lods: Map<number, GaussianSplatLod> = new Map()
  private _position: THREE.Vector3
  private _rotation: THREE.Quaternion | THREE.Vector3
  private _scale: number

  constructor(config: T = {} as T) {
    super({
      ...config,
      name: config.name ?? "collider",
    })
    this._config = config

    this._position = config.position ?? new THREE.Vector3()
    this._rotation = config.rotation ?? new THREE.Quaternion()
    this._scale = config.scale ?? 1.0
  }

  //=========================
  // Setup
  //=========================

  public registerLod(level: number, url: string) {
    const lod: GaussianSplatLod = {
      level,
      url,
      splatMesh: null,
      isActive: false,
    }

    debug(`Splat LOD${level} registered: ${url}`, "Splat")

    this._lods.set(level, lod)
  }

  public setLodLevel(level: number): void {
    this._lods.forEach((lod) => {
      if (lod.level === level) {
        this.activateLod(lod)
      } else {
        this.deactivateLod(lod)
      }
    })
  }

  private async activateLod(lod: GaussianSplatLod): Promise<void> {
    if (lod.isActive) return
    if (!lod.splatMesh) await this.loadLod(lod.level)
    lod.isActive = true

    if (lod.level === 3 && lod.splatMesh) lod.splatMesh.opacity = 3.0

    if (lod.splatMesh) Catalyst._.scene.add(lod.splatMesh)
  }

  private deactivateLod(lod: GaussianSplatLod): void {
    if (!lod.isActive) return
    lod.isActive = false

    if (lod.splatMesh) Catalyst._.scene.remove(lod.splatMesh)
  }

  public async loadLod(level: number): Promise<SplatMesh | null> {
    const lod = this._lods.get(level)

    if (!lod) return null
    if (lod.splatMesh) return lod.splatMesh

    try {
      const splatMesh = new SplatMesh({
        url: lod.url,
      })

      if (this._position) splatMesh.position.copy(this._position)
      if (this._rotation)
        this._rotation instanceof THREE.Quaternion
          ? splatMesh.rotation.setFromQuaternion(this._rotation)
          : splatMesh.rotation.setFromVector3(this._rotation)
      if (this._scale) splatMesh.scale.setScalar(this._scale)

      lod.splatMesh = splatMesh

      debug(`loaded LOD: ${level}`, "Splat")

      return splatMesh
    } catch (error) {
      console.error("SPLAT - Failed to create SplatMesh from buffer:", error)
      throw error
    }
  }

  //=========================
  // Getters & Setters
  //=========================
}
