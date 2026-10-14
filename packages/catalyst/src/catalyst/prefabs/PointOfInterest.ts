import { svgIcon } from "../nodes/icon"
import { Node3D, Debug, BoxCollider, type BoxColliderConfig } from "../nodes"
import { DebugShapes } from "../debug/DebugShapes"
import { Catalyst } from "../core"
import { worldToScreenSpace } from "../utils"
import { Signal } from "../signals"
import { Raycast } from "../nodes"

interface PointOfInterestConfig {
  name?: string
  visualise?: boolean
  onInteract?: () => void
  modalName?: string
  collider?: BoxColliderConfig
}

export interface PointOfInterestSignals {
  onInteract: Signal<void>
}

export class PointOfInterest extends Node3D {
  static icon = svgIcon(
    '<path d="M8 14.5s4.5-4.3 4.5-8a4.5 4.5 0 0 0-9 0c0 3.7 4.5 8 4.5 8z"/><circle cx="8" cy="6.5" r="1.5"/>'
  )

  private _active: boolean = true
  private _activeColour: number = 0x00ff00
  private _element: HTMLElement
  private _collider: BoxCollider
  private _raycast: Raycast
  private _onInteract: (() => void) | null = null
  private _pointOfInterestSignals: PointOfInterestSignals = {
    onInteract: new Signal<void>(),
  }
  private _isFocused: boolean = false
  private _modalName: string | null = null
  private _isOccluded: boolean = false

  private pulseDuration = 3

  constructor(config: PointOfInterestConfig) {
    super({
      name: config?.name ?? "pointOfInterest",
      visualise: config?.visualise ?? false,
    })

    this.active = false

    this._element = this.createUIDiv()
    this._collider = new BoxCollider({
      width: 0.125,
      height: 0.125,
      depth: 0.125,
      name: config?.name
        ? `${config.name}-collider`
        : "pointOfInterest-collider",
      visualise: config?.visualise ?? false,
      ...config?.collider,
    })

    // Setup raycast for occlusion checking
    this._raycast = new Raycast({ visualise: false })
    this._raycast.layers = 1
    this.addNode(this._raycast)

    this._onInteract = config?.onInteract ?? null
    this._modalName = config?.modalName ?? null

    this._collider.isTrigger = true
    this._collider.layers = 9

    this.addNode(this._collider)

    this.attachPointOfInterestSignals()
    this.registerListeners()
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

  public set onInteract(callback: () => void) {
    this._onInteract = callback
  }

  public get modalName(): string | null {
    return this._modalName
  }

  public set modalName(name: string | null) {
    this._modalName = name
  }

  public set isFocused(focused: boolean) {
    this._isFocused = focused

    if (this._isFocused) {
      this._element.classList.add("focused")
    } else {
      this._element.classList.remove("focused")
    }
  }

  //=========================
  // Methods
  //=========================

  protected attachPointOfInterestSignals(): void {
    this._signals = {
      ...this._signals,
      ...this._pointOfInterestSignals,
    }
  }

  protected registerListeners(): void {
    this.signals.onInteract.subscribe(() => {
      if (this?._onInteract) this._onInteract()
    })
  }

  private createUIDiv(): HTMLElement {
    const element = document.createElement("div")

    element.classList.add("poi-ui")
    Catalyst._.ui?.canvas.appendChild(element)

    const dot = document.createElement("div")
    dot.classList.add("poi-ui-dot")
    element.appendChild(dot)

    const pulse = document.createElement("div")
    pulse.classList.add("poi-ui-pulse")
    dot.appendChild(pulse)

    element.addEventListener("click", () => {
      if (this?._onInteract) this._onInteract()
    })

    const unsubscribe = Catalyst._.signals.onPostRender.subscribe(() => {
      const screenData = worldToScreenSpace(this.transform.getWorldPosition())

      if (!screenData) {
        if (element) {
          element.classList.add("hidden")
          element.style.setProperty("--poi-opacity", "0")
        }
        return
      }

      if (screenData) {
        if (!element) return

        const maxDistance = 5
        const fadeStart = maxDistance * 0.5

        // Check occlusion
        this._isOccluded = this.checkOcclusion(maxDistance)

        element.style.left = screenData.screenPosition.x + "px"
        element.style.top = screenData.screenPosition.y + "px"

        // Fade out when far away or occluded

        let opacity = Math.max(
          0,
          1 - (screenData.distance - fadeStart) / (maxDistance - fadeStart),
        )

        // Fully hide if occluded
        if (this._isOccluded) {
          opacity = 0
        }

        element.style.setProperty("--poi-opacity", opacity.toString())

        if (!opacity) {
          element.classList.add("hidden")
        } else {
          element.classList.remove("hidden")
        }

        // Scale based on distance
        const scaleStart = maxDistance * 0.5
        const normalised =
          1 -
          Math.max(0, screenData.distance - scaleStart) /
            (maxDistance - scaleStart)
        const scale = Math.max(0.1, Math.exp(normalised * 2 - 2))

        element.style.setProperty("--poi-scale", scale.toString())

        if (!opacity) return

        const t =
          (Catalyst._.elapsed % (this.pulseDuration * 1000)) /
          (this.pulseDuration * 1000)

        let pulseScale: number
        let pulseOpacity: number

        if (t < 0.8) {
          // 0% -> 80%: scale 1->2, opacity 1->0
          const p = t / 0.8
          pulseScale = 1 + p
          pulseOpacity = 1 - p
        } else {
          // 80% -> 100%: scale 2->4, opacity stays 0
          const p = (t - 0.8) / 0.2
          pulseScale = 2 + p * 2
          pulseOpacity = 0
        }

        pulse.style.opacity = pulseOpacity.toString()
        pulse.style.scale = `${pulseScale}`
      }
    })
    this.track(unsubscribe)

    return element
  }

  private checkOcclusion(maxDistance: number): boolean {
    const cameraPos = Catalyst._.camera?.view.position
    if (!cameraPos) return false

    const poiPos = this.transform.getWorldPosition()
    const direction = cameraPos.clone().sub(poiPos).normalize()
    const distance = poiPos.distanceTo(cameraPos)

    // If we are above the max distance there is no need to check for occlusion
    if (distance > maxDistance) return true

    const inverseRotation = this._raycast.transform
      .getWorldRotation()
      .clone()
      .invert()
    const localDirection = direction.clone().applyQuaternion(inverseRotation)

    this._raycast.setDirection(localDirection)
    this._raycast.setLength(distance)

    const results = this._raycast.cast()
    return results && results.length > 0
  }

  protected override onDispose(): void {
    this._element.remove()
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
