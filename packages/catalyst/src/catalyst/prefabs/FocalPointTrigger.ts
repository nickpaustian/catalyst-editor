import { svgIcon } from "../nodes/icon"
import { Catalyst } from "../core"
import { Node3D, BoxCollider, type ExposedProperty } from "../nodes"
import type { FocalPoint } from "./FocalPoint"

interface FocalPointTriggerConfig {
  name?: string
  visualise?: boolean
  width?: number
  height?: number
  depth?: number
  focalPoints: FocalPoint[]
}

export class FocalPointTrigger extends Node3D {
  static icon = svgIcon(
    '<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2" stroke-dasharray="2.5 2"/><circle cx="8" cy="8" r="2.5"/><circle cx="8" cy="8" r="0.8" fill="currentColor"/>'
  )

  static exposed: ExposedProperty[] = [
    { key: "width", type: "number", min: 0.01, step: 0.1 },
    { key: "height", type: "number", min: 0.01, step: 0.1 },
    { key: "depth", type: "number", min: 0.01, step: 0.1 },
  ]

  private _collider: BoxCollider
  private _containedFocalPoints: FocalPoint[] = []
  private _allFocalPoints: FocalPoint[]
  private _isActive: boolean = true

  constructor(config: FocalPointTriggerConfig) {
    super({
      name: config?.name ?? "focalPointTrigger",
      visualise: config?.visualise ?? false,
    })

    this._collider = new BoxCollider({
      name: config?.name
        ? `${config?.name}Collider`
        : "focalPointTriggerCollider",
      width: config?.width ?? 1,
      height: config?.height ?? 1,
      depth: config.depth ?? 1,
      visualise: config?.visualise ?? false,
    })

    this._collider.setVisualisationColour(0xff0000)

    this._collider.isTrigger = true

    this.addNode(this._collider)

    this._allFocalPoints = config.focalPoints

    this.track(
      Catalyst._.signals.onStart.subscribe(() => {
        this.getFocalPoints()
      })
    )

    this._collider.signals.onTriggerEnter.subscribe((_data) => {
      this._containedFocalPoints.forEach((focalpoint) => {
        if (this._isActive) focalpoint.active = true
      })
    })

    this._collider.signals.onTriggerExit.subscribe((_data) => {
      this._containedFocalPoints.forEach((focalpoint) => {
        focalpoint.active = false
      })
    })
  }

  //=========================
  // Setters & Getters
  //=========================

  public get collider(): BoxCollider {
    return this._collider
  }

  public get width(): number {
    return this._collider.width
  }

  public set width(width: number) {
    this._collider.width = width
    this.resized()
  }

  public get height(): number {
    return this._collider.height
  }

  public set height(height: number) {
    this._collider.height = height
    this.resized()
  }

  public get depth(): number {
    return this._collider.depth
  }

  public set depth(depth: number) {
    this._collider.depth = depth
    this.resized()
  }

  private resized(): void {
    if (Catalyst._.getIsRunning()) this.getFocalPoints()
  }

  public set focalPoints(fps: FocalPoint[]) {
    this._allFocalPoints = fps
    if (Catalyst._.getIsRunning()) this.getFocalPoints()
  }

  public set active(active: boolean) {
    this._isActive = active
  }

  //=========================
  // Methods
  //=========================

  public getFocalPoints(): void {
    this._containedFocalPoints = []
    this._allFocalPoints.forEach((focalpoint) => {
      if (this._collider.containsPoint(focalpoint.transform.position))
        this._containedFocalPoints.push(focalpoint)
    })
  }
}
