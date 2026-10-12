import * as THREE from "three"
import { Node } from "./Node"
import { Transform3D } from "./Transform3D"

// Debug
import { Debug } from "./Debug"
import { DebugShapes } from "../debug/DebugShapes"

interface Node3DConfig {
  name?: string
  visualise?: boolean
}

/**
 * Node3D - A spatial node with transform capabilities.
 */
export class Node3D extends Node {
  private _transform: Transform3D

  // Debug Visualisation
  protected visualisation: Debug | null = null
  protected _visualised: boolean = false
  protected _wireframe!: THREE.LineSegments | THREE.Group | THREE.Line

  constructor(config: Node3DConfig | string = {}) {
    let name: string = "node3D"
    let visualise: boolean = false

    if (typeof config === "string") {
      name = config
    } else {
      name = config.name ?? "node3D"
      visualise = config.visualise ?? false
    }

    super(name)
    this._transform = new Transform3D("transform")
    super.addNode(this._transform, "transform")

    if (visualise) {
      this.createVisualisation()
      this._visualised = true
    }
  }

  /**
   * Get the transform node.
   */
  public get transform(): Transform3D {
    return this._transform
  }

  //=========================
  // Debug Visualisation
  //=========================

  /**
   * Create visualisation for this spatial node.
   * Default: simple cube. Override in subclasses for custom shapes.
   */
  protected createVisualisation(): void {
    this.visualisation = new Debug(`${this.name}Debug`)
    this.addNode(this.visualisation)

    const defaultShape = DebugShapes.cube({
      size: 0.05,
      color: 0xcccccc,
      autoAdd: false,
    })

    this.visualisation.setDebugShape(defaultShape)
  }

  public setVisualisationColour(colour: number): void {
    if (!this._wireframe) return

    if (
      this._wireframe instanceof THREE.LineSegments ||
      this._wireframe instanceof THREE.Line
    ) {
      this._wireframe.material.color.set(colour)
    } else if (this._wireframe instanceof THREE.Group) {
      //TODO: Handle Group
    }
  }

  /**
   * Toggle visualisation.
   */
  public set visualised(enabled: boolean) {
    if (!this.visualisation && enabled) {
      this.createVisualisation()
    }

    if (this.visualisation) {
      this._visualised = enabled
      this.visualisation.visible = enabled
    }
  }

  /**
   * Check if visualisation is enabled.
   */
  public get visualised(): boolean {
    return this._visualised
  }
}
