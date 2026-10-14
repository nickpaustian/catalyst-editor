import { svgIcon } from "../nodes/icon"
import { Node3D, Debug } from "../nodes"
import { DebugShapes } from "../debug/DebugShapes"

interface FocalPointConfig {
  name?: string
  visualise?: boolean
}

export class FocalPoint extends Node3D {
  static icon = svgIcon(
    '<circle cx="8" cy="8" r="4.5"/><circle cx="8" cy="8" r="1" fill="currentColor"/><path d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15"/>'
  )

  private _active: boolean = true
  private _activeColour: number = 0x00ff00
  private _element: HTMLElement | null = null

  constructor(config: FocalPointConfig) {
    super({
      name: config?.name ?? "pointOfInterest",
      visualise: config?.visualise ?? false,
    })

    this.active = false
  }

  //=========================
  // Setters & Getters
  //=========================

  public get active(): boolean {
    return this._active
  }

  public set active(state: boolean) {
    this._active = state

    if (this._active) {
      this.setVisualisationColour(this._activeColour)
    } else {
      this.setVisualisationColour(0xcccccc)
    }
  }

  public get element(): HTMLElement | null {
    return this._element
  }

  //=========================
  // Debug
  //=========================

  protected override createVisualisation(): void {
    this.visualisation = new Debug("poiDebug")
    this.addNode(this.visualisation)

    const octahedron = DebugShapes.polyhedron({
      radius: 0.05,
    })

    this._wireframe = octahedron

    this.visualisation.setDebugShape(octahedron)
  }
}
