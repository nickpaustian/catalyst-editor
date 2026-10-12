import { Catalyst } from "../core"
import { Node3D, BoxCollider } from "../nodes"
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
