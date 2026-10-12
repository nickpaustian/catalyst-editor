import * as THREE from "three"
import { Node3D } from "./Node3D"
import { Catalyst } from "../core/Catalyst"
import { type PhysicsLayer, PhysicsLayerSet } from "@vitrine/catalyst/velora/utils"
import type { RaycastIntersection } from "@vitrine/catalyst/velora/colliders/Collider"

export interface RaycastConfig {
  name?: string
  direction?: THREE.Vector3
  length?: number
  visualise?: boolean
}

/**
 * Raycast - A spatial node for raycasting against scene objects.
 */
export class Raycast extends Node3D {
  private direction: THREE.Vector3 = new THREE.Vector3(0, 0, -1)
  private length: number = 1
  private raycaster: THREE.Raycaster = new THREE.Raycaster()
  private visualisationLine: THREE.Line | null = null
  private isVisualised: boolean = false
  private unsubscribeFromRender: (() => void) | null = null
  private _layers: PhysicsLayerSet = new PhysicsLayerSet()

  constructor(config: RaycastConfig = {}) {
    super(config?.name ?? "raycast")

    if (config.direction) this.direction.copy(config.direction).normalize()
    if (config.length) this.length = config.length

    if (config.visualise) {
      this.enableVisualisation()
    }
  }

  //=========================
  // Getters & Setters
  //=========================

  public get layers(): PhysicsLayerSet {
    return this._layers
  }

  public set layers(layers: PhysicsLayer | PhysicsLayer[]) {
    this._layers.set(layers)
  }

  private createVisualisationLine(): void {
    const worldOrigin = this.transform.getWorldPosition()
    const worldDirection = this.direction
      .clone()
      .applyQuaternion(this.transform.getWorldRotation())
    const points = [
      worldOrigin.clone(),
      worldOrigin.clone().addScaledVector(worldDirection, this.length),
    ]

    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({ color: 0x00ff00 })
    this.visualisationLine = new THREE.Line(geometry, material)

    const catalyst = Catalyst.getInstance()
    catalyst.scene.add(this.visualisationLine)
  }

  private updateVisualisationLine(): void {
    if (!this.visualisationLine) return

    const worldOrigin = this.transform.getWorldPosition()
    const worldDirection = this.direction
      .clone()
      .applyQuaternion(this.transform.getWorldRotation())

    const points = [
      worldOrigin.clone(),
      worldOrigin.clone().addScaledVector(worldDirection, this.length),
    ]

    const geometry = this.visualisationLine.geometry as THREE.BufferGeometry
    geometry.setFromPoints(points)
  }

  public cast(): RaycastIntersection[][] {
    if (this.isVisualised) {
      this.updateVisualisationLine()
    }

    const worldOrigin = this.transform.getWorldPosition()
    const worldDirection = this.direction
      .clone()
      .applyQuaternion(this.transform.getWorldRotation())

    this.raycaster.set(worldOrigin, worldDirection)

    const intersections: RaycastIntersection[][] = []

    Catalyst._.physics?.getColliders().forEach((collider) => {
      if (this.layers.collidesWith(collider.layers)) {
        const intersectionResult = collider.raycastGeometry(
          this.raycaster.ray,
          this.length
        )

        if (intersectionResult) intersections.push(intersectionResult)
      }
    })

    intersections.sort((a, b) => a?.[0]?.distance - b?.[0]?.distance)

    return intersections
  }

  public setDirection(direction: THREE.Vector3): this {
    this.direction.copy(direction).normalize()
    return this
  }

  public setLength(length: number): this {
    this.length = length
    if (this.isVisualised) {
      this.updateVisualisationLine()
    }
    return this
  }

  public getDirection(): THREE.Vector3 {
    return this.direction.clone()
  }

  public getLength(): number {
    return this.length
  }

  public enableVisualisation(): this {
    if (this.isVisualised) return this

    this.createVisualisationLine()
    this.isVisualised = true

    // Subscribe to render updates and store unsubscribe function
    this.unsubscribeFromRender =
      Catalyst.getInstance().signals.onRender.subscribe((data) => {
        this.onRender?.(data.deltaTime)
      })

    return this
  }

  protected override onDispose(): void {
    this.disableVisualisation()
  }

  public disableVisualisation(): this {
    if (!this.isVisualised) return this

    // Unsubscribe from render signal
    if (this.unsubscribeFromRender) {
      this.unsubscribeFromRender()
      this.unsubscribeFromRender = null
    }

    if (this.visualisationLine) {
      Catalyst.getInstance().scene.remove(this.visualisationLine)
      this.visualisationLine = null
    }

    this.isVisualised = false
    return this
  }

  public onRender?(_deltaTime: number): void {
    if (this.isVisualised) {
      this.updateVisualisationLine()
    }
  }
}
