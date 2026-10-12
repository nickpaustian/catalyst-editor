import { Kinetic, Helm, Bounds, Vector3, Spring } from "@vitrine/catalyst/helm"
import type { Padding } from "./types"
import { resolvePadding, nextTick } from "./utils"
import styles from "./spektra.css?raw"

declare global {
  interface HTMLElement {
    __spektra?: Spektra
  }
}

export type SpektraMode = "inline" | "expanded" | "collapsing"

export interface SpektraOptions {
  mode?: SpektraMode
  expandOnClick?: boolean
  onExpandStart?: () => void
  onExpandEnd?: () => void
  onCollapseStart?: () => void
  onCollapseEnd?: () => void
  fit?: "contain" | "cover" | "none"
  padding?: Padding
  boundsPadding?: Padding
  minScale?: number
  maxScale?: number
  invertScroll?: boolean
  collapseOnZoomOut?: boolean
  collapseThreshold?: number
  doubleTapZoom?: boolean
  doubleTapZoomLevel?: number
}

export default class Spektra {
  private static _styleInjected: boolean = false
  private static _expanded: Spektra | null = null

  private _el: HTMLElement | null
  private _imgEl: HTMLElement | null = null
  private _img: HTMLImageElement | null
  private _options: SpektraOptions | null
  private _helm: Helm | null = null
  private _kinetic: Kinetic | null = null
  private _resizeObserver: ResizeObserver | null = null

  private _baseScale: number = 1.0

  private _isActive: boolean = false
  private _frameId: number | null = null
  private _lastTime: number = 0

  private _boundsX: Bounds = new Bounds()
  private _boundsY: Bounds = new Bounds()
  private _boundsScale: Bounds = new Bounds({ min: 0.5, max: 5 })
  private _wasScaling: number = 0

  private _containerWidth: number = 0
  private _containerHeight: number = 0

  private _spring: Spring = new Spring({ damping: 0.3, stiffness: 0.025 })
  private _transitionSpring: Spring = new Spring({
    stiffness: 0.15,
    damping: 0.65,
  })
  private _anchor: HTMLElement | null = null
  private _overlay: HTMLElement | null = null
  private _close: HTMLElement | null = null
  private _mode: SpektraMode = "expanded"
  private _isTransitioning: boolean = false
  private _onBackgroundClick: ((e: MouseEvent) => void) | null = null

  private _cachedZoomOrigin: { x: number; y: number } | null = null

  constructor(selector: string, options: SpektraOptions = {}) {
    this._el = document.querySelector(selector)
    if (!this._el) {
      throw new Error(`[Spektra] Element not found: ${selector}`)
    }

    this._img = this._el.querySelector("img") || null
    this._options = options

    this.init()
  }

  public static get isOpen(): boolean {
    return Spektra._expanded !== null
  }

  public static close(): void {
    Spektra._expanded?.collapse()
  }

  public init(): void {
    if (!this._el) return

    this.injectStyles()

    const mode = this._options?.mode ?? "expanded"

    if (mode === "inline") {
      this.initInline()
    } else {
      this.initExpanded()
    }

    this._el.__spektra = this
  }

  private initCore(): void {
    const el = this._el
    const img = this._img
    if (!el || !img) return

    this._imgEl = document.createElement("div")
    this._imgEl.classList.add("spektra-image")
    this._imgEl.appendChild(img)
    el.appendChild(this._imgEl)

    this._boundsScale = new Bounds({
      min: (this._options?.minScale ?? 0.5) - 1,
      max: (this._options?.maxScale ?? 5) - 1,
    })

    this._resizeObserver = new ResizeObserver(() => {
      if (!this._el) return
      const rect = this._el.getBoundingClientRect()
      this._containerWidth = rect.width
      this._containerHeight = rect.height
      if (this._containerWidth === 0 || this._containerHeight === 0) return
      this._baseScale = this.calculateFitScale()
      this.applyTransform()
    })
    this._resizeObserver.observe(el)

    const scrollModifier =
      this._options?.invertScroll === false ? 0.001 : -0.001

    this._helm = new Helm({
      target: el,
      mouse: { drag: true },
      force: {
        mouse: { xAxis: "x", yAxis: "y", raw: true },
        touch: { xAxis: "x", yAxis: "y", raw: true },
        scroll: { axis: "z", modifier: scrollModifier },
        pinch: { axis: "z", raw: true },
      },
    })

    this._kinetic = new Kinetic({ friction: new Vector3(0.92, 0.92, 0.05) })

    this.setupDoubleTap()

    if (this._img?.complete) {
      this.onImageLoad()
    } else if (this._img) {
      this._img.addEventListener("load", () => this.onImageLoad(), {
        once: true,
      })
    }
  }

  private initExpanded(): void {
    this._mode = "expanded"
    this._el?.classList.add("spektra")
    this.initCore()
    this.startLoop()
  }

  private initInline(): void {
    const el = this._el
    const img = this._img
    if (!el || !img) return

    this._mode = "inline"

    this._anchor = document.createElement("div")
    this._anchor.classList.add("spektra-anchor")

    const anchorImg = img.cloneNode() as HTMLImageElement
    anchorImg.style.opacity = "0"
    this._anchor.appendChild(anchorImg)

    el.parentNode?.insertBefore(this._anchor, el)

    document.body.appendChild(el)

    el.classList.add("spektra", "spektra-floating")

    this.initCore()

    this.showAnchor()
    this._helm?.pause()

    if (this._options?.expandOnClick !== false) {
      this._anchor.style.cursor = "pointer"
      this._anchor.addEventListener("click", () => this.expand())
    }
  }

  private onImageLoad(): void {
    if (!this._img || !this._imgEl || !this._el) return
    this._imgEl.style.width = `${this._img.naturalWidth}px`
    this._imgEl.style.height = `${this._img.naturalHeight}px`
  }

  private showAnchor(onComplete?: () => void): void {
    if (!this._anchor || !this._el) return
    const anchorImg = this._anchor.querySelector("img")
    if (anchorImg) anchorImg.style.opacity = "1"

    this._el.classList.add("fading")
    this._el.addEventListener(
      "transitionend",
      () => {
        this._el?.classList.remove("fading")
        this._el?.classList.add("hidden")
        onComplete?.()
      },
      { once: true }
    )
  }

  private showFloating(): void {
    if (!this._anchor || !this._el) return
    const anchorImg = this._anchor.querySelector("img")
    if (anchorImg) anchorImg.style.opacity = "0"
    this._el.classList.remove("hidden", "fading")
    this._el.style.visibility = "visible"
  }

  private calculateFitScale(): number {
    if (!this._img || !this._el) return 1

    const fit = this._options?.fit ?? "contain"
    if (fit === "none") return 1

    const p = resolvePadding(this._options?.padding)
    const availableWidth = this._containerWidth - p.left - p.right
    const availableHeight = this._containerHeight - p.top - p.bottom

    const scaleX = availableWidth / this._img.naturalWidth
    const scaleY = availableHeight / this._img.naturalHeight

    return fit === "contain"
      ? Math.min(scaleX, scaleY)
      : Math.max(scaleX, scaleY)
  }

  private startLoop(): void {
    if (this._isActive) return
    this._isActive = true
    this._lastTime = performance.now()
    this.tick()
  }

  private cancelFrame(): void {
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId)
      this._frameId = null
    }
  }

  private tick() {
    if (!this._isActive) return
    this._frameId = requestAnimationFrame((t) => {
      const dt = (t - this._lastTime) / 1000
      this._lastTime = t
      this.update(dt)
      this.tick()
    })
  }

  private update(dt: number): void {
    if (!this._kinetic || !this._helm) return

    if (this._isTransitioning) {
      const prevZ = this._kinetic.position.z
      this.applySpringForces(this._transitionSpring)
      this._kinetic.update(dt)
      const newZ = this._kinetic.position.z

      if (prevZ !== newZ) {
        this.applyScaleCompensation(prevZ, newZ)
      }

      this.applyTransform()

      if (this._kinetic.isIdle) {
        this.onTransitionComplete()
      }
      return
    }

    const force = this._helm.mapper.force
    const isDragging = this._helm.mapper.inputForce.dragging

    if (isDragging) {
      this._kinetic.applyDisplacement(force)
    } else {
      this._kinetic.applyForce(this.applyResistance(force))
    }

    this._helm.mapper.clearForces()

    const prevZ = this._kinetic.position.z

    this.calculateBounds()
    this.applySpringForces()
    this._kinetic.update(dt)

    const newZ = this._kinetic.position.z
    if (prevZ !== newZ) {
      this.applyScaleCompensation(prevZ, newZ)
    }

    // Check for zoom-out collapse trigger
    if (this._mode === "expanded" && this._anchor && !this._isTransitioning) {
      const collapseEnabled = this._options?.collapseOnZoomOut !== false
      const threshold = this._options?.collapseThreshold ?? -0.5

      if (
        collapseEnabled &&
        this._kinetic.position.z < this._boundsScale.min + threshold
      ) {
        this.collapse()
        return
      }
    }

    this.applyTransform()
  }

  private applyResistance(force: Vector3): Vector3 {
    if (!this._kinetic) return force

    const p = this._kinetic.position

    const overX = this._boundsX.overshoot(p.x)
    const overY = this._boundsY.overshoot(p.y)
    const overZ = this._boundsScale.overshoot(p.z)

    const rangeX = this._boundsX.max - this._boundsX.min
    const rangeY = this._boundsY.max - this._boundsY.min
    const rangeZ = this._boundsScale.max - this._boundsScale.min

    const rx = rangeX > 0 ? Math.min(1, Math.abs(overX) / rangeX) : 0
    const ry = rangeY > 0 ? Math.min(1, Math.abs(overY) / rangeY) : 0
    const rz = rangeZ > 0 ? Math.min(1, Math.abs(overZ) / rangeZ) : 0

    return new Vector3(
      force.x * (1 - rx),
      force.y * (1 - ry),
      force.z * (1 - rz)
    )
  }

  private applySpringForces(spring?: Spring): void {
    if (!this._kinetic) return

    const s = spring ?? this._spring
    const p = this._kinetic.position
    const v = this._kinetic.velocity

    const overshootX = this._boundsX.overshoot(p.x)
    const overshootY = this._boundsY.overshoot(p.y)
    const overshootZ = this._boundsScale.overshoot(p.z)

    if (overshootX !== 0) {
      const target = overshootX < 0 ? this._boundsX.min : this._boundsX.max
      v.x += s.force(p.x, target, v.x)
    }

    if (overshootY !== 0) {
      const target = overshootY < 0 ? this._boundsY.min : this._boundsY.max
      v.y += s.force(p.y, target, v.y)
    }

    if (overshootZ !== 0) {
      const activeForce = this._helm?.mapper.force
      if (spring || Math.abs(activeForce?.z ?? 0) < 0.000001) {
        const target =
          overshootZ < 0 ? this._boundsScale.min : this._boundsScale.max
        v.z += s.force(p.z, target, v.z)
      }
    }
  }

  private applyTransform(): void {
    if (!this._imgEl || !this._kinetic) return
    const p = this._kinetic.position
    const scale = this._baseScale * Math.pow(2, p.z)
    this._imgEl.style.transform = `translate(${p.x}px, ${p.y}px) scale(${scale})`
  }

  private getPointerRelative(): { x: number; y: number } {
    if (!this._helm || !this._el) return { x: 0, y: 0 }

    const pointer = this._helm.mapper.pointer
    const rect = this._el.getBoundingClientRect()

    return {
      x: pointer.x - rect.left - rect.width / 2,
      y: pointer.y - rect.top - rect.height / 2,
    }
  }

  private getZoomOrigin(): { x: number; y: number } {
    if (this._cachedZoomOrigin) return this._cachedZoomOrigin

    if (!this._helm || !this._el || !this._kinetic || !this._img)
      return { x: 0, y: 0 }

    const pointer = this._helm.mapper.pointer
    if (!pointer.active) return { x: 0, y: 0 }

    const cursor = this.getPointerRelative()
    const p = this._kinetic.position
    const scale = this._baseScale * Math.pow(2, p.z)

    const halfImgW = (this._img.naturalWidth * scale) / 2
    const halfImgH = (this._img.naturalHeight * scale) / 2

    const imgLeft = p.x - halfImgW
    const imgRight = p.x + halfImgW
    const imgTop = p.y - halfImgH
    const imgBottom = p.y + halfImgH

    return {
      x: Math.max(imgLeft, Math.min(imgRight, cursor.x)),
      y: Math.max(imgTop, Math.min(imgBottom, cursor.y)),
    }
  }

  private applyScaleCompensation(prevZ: number, newZ: number): void {
    if (!this._kinetic || !this._el) return

    const origin = this.getZoomOrigin()

    const prevScale = Math.pow(2, prevZ)
    const newScale = Math.pow(2, newZ)
    const scaleRatio = newScale / prevScale

    const p = this._kinetic.position
    p.x = origin.x - (origin.x - p.x) * scaleRatio
    p.y = origin.y - (origin.y - p.y) * scaleRatio
  }

  private calculateBounds(): void {
    if (!this._img || !this._kinetic) return

    const bp = resolvePadding(this._options?.boundsPadding)
    const scale = this._baseScale * Math.pow(2, this._kinetic.position.z ?? 0)
    const scaleFactor = scale / this._baseScale

    const imgWidth = this._img.naturalWidth * scale
    const imgHeight = this._img.naturalHeight * scale

    const effectiveWidth =
      this._containerWidth - (bp.left + bp.right) * scaleFactor
    const effectiveHeight =
      this._containerHeight - (bp.top + bp.bottom) * scaleFactor

    const idealX = Math.max(0, (imgWidth - effectiveWidth) / 2)
    const idealY = Math.max(0, (imgHeight - effectiveHeight) / 2)

    const p = this._kinetic.position
    const isScaling =
      Math.abs(this._kinetic.velocity.z) > this._kinetic.idleThreshold
    const isZoomingIn = isScaling && this._kinetic.velocity.z > 0

    // Zooming in: release all bounds
    const belowMinScale = this._kinetic.position.z < this._boundsScale.min

    if (isZoomingIn && !belowMinScale) {
      this.setBoundsInfinity()
      this._wasScaling = performance.now()
      return
    }

    // Zooming out: snapshot immediately
    if (isScaling && this._wasScaling > 0) {
      this.snapshotBounds(idealX, idealY, p)
      this._wasScaling = 0
    }

    // Zooming out: shrink toward ideal
    if (isScaling) {
      this._boundsX.min = Math.max(-idealX, this._boundsX.min)
      this._boundsX.max = Math.min(idealX, this._boundsX.max)
      this._boundsY.min = Math.max(-idealY, this._boundsY.min)
      this._boundsY.max = Math.min(idealY, this._boundsY.max)
      return
    }

    // Debounce after zoom in stops
    if (this._wasScaling > 0) {
      if (performance.now() - this._wasScaling < 100) return
      this.snapshotBounds(idealX, idealY, p)
      this._wasScaling = 0
      return
    }

    // Normal: shrink toward ideal, follow position inward
    this._boundsX.min = Math.min(-idealX, Math.max(p.x, this._boundsX.min))
    this._boundsX.max = Math.max(idealX, Math.min(p.x, this._boundsX.max))
    this._boundsY.min = Math.min(-idealY, Math.max(p.y, this._boundsY.min))
    this._boundsY.max = Math.max(idealY, Math.min(p.y, this._boundsY.max))
  }

  private setBoundsInfinity(): void {
    this._boundsX.min = -Infinity
    this._boundsX.max = Infinity
    this._boundsY.min = -Infinity
    this._boundsY.max = Infinity
  }

  private snapshotBounds(idealX: number, idealY: number, p: Vector3): void {
    this._boundsX.min = Math.min(-idealX, p.x)
    this._boundsX.max = Math.max(idealX, p.x)
    this._boundsY.min = Math.min(-idealY, p.y)
    this._boundsY.max = Math.max(idealY, p.y)
  }

  public expand(): void {
    if (this._mode === "expanded") return

    const anchor = this._anchor
    const el = this._el
    const img = this._img
    const imgEl = this._imgEl
    const kinetic = this._kinetic
    if (!anchor || !el || !img || !imgEl || !kinetic) return

    if (Spektra._expanded && Spektra._expanded !== this) {
      Spektra._expanded.collapse()
    }
    this._mode = "expanded"
    this._isTransitioning = true
    Spektra._expanded = this

    this._options?.onExpandStart?.()

    // Sync position to anchor before expanding
    const anchorRect = anchor.getBoundingClientRect()

    // Show floating element
    el.classList.remove("hidden")
    this.showFloating()
    el.classList.add("spektra-expanded")

    this._overlay = document.createElement("div")
    this._overlay.classList.add("spektra-overlay")
    document.body.appendChild(this._overlay)
    nextTick(() => {
      this._overlay?.classList.add("active")
    })

    this._close = document.createElement("div")
    this._close.classList.add("spektra-close")
    this._close.textContent = "Close"
    this._close.addEventListener("pointerup", () => {
      this.collapse()
    })
    document.body.appendChild(this._close)

    // Update container for fullscreen
    this._containerWidth = window.innerWidth
    this._containerHeight = window.innerHeight
    this._baseScale = this.calculateFitScale()

    // Find where the anchor centre is relative to screen centre?
    const startX =
      anchorRect.left + anchorRect.width / 2 - this._containerWidth / 2
    const startY =
      anchorRect.top + anchorRect.height / 2 - this._containerHeight / 2

    // What scale makes the image match anchor size?
    const anchorScale = anchorRect.width / img.naturalWidth
    const startZ = Math.log2(anchorScale / this._baseScale)

    // Set kinetic to anchor position
    kinetic.position.x = startX
    kinetic.position.y = startY
    kinetic.position.z = startZ
    kinetic.velocity.set(0, 0, 0)

    // Bounds at centre so spring pulls toward it
    this._boundsX.min = 0
    this._boundsX.max = 0
    this._boundsY.min = 0
    this._boundsY.max = 0
    this._boundsScale.min = 0
    this._boundsScale.max = 0

    this._onBackgroundClick = (e: MouseEvent) => {
      if (!imgEl.contains(e.target as Node)) {
        this.collapse()
      }
    }
    el.addEventListener("click", this._onBackgroundClick)

    this.startLoop()
    this.applyTransform()
  }

  public collapse(): void {
    if (this._mode === "inline" || this._isTransitioning) return

    const anchor = this._anchor
    const img = this._img
    if (!anchor || !img) return

    this._mode = "collapsing"
    this._isTransitioning = true

    this._options?.onCollapseStart?.()

    this._helm?.pause()

    // Clean up background click
    if (this._onBackgroundClick) {
      this._el?.removeEventListener("click", this._onBackgroundClick)
      this._onBackgroundClick = null
    }

    // Remove close button
    this._close?.remove()
    this._close = null

    // Fade overlay
    this._overlay?.classList.remove("active")
    this._overlay?.addEventListener(
      "transitionend",
      () => {
        this._overlay?.remove()
        this._overlay = null
      },
      { once: true }
    )

    // Calculate target from anchor
    const anchorRect = anchor.getBoundingClientRect()

    const targetX =
      anchorRect.left + anchorRect.width / 2 - this._containerWidth / 2
    const targetY =
      anchorRect.top + anchorRect.height / 2 - this._containerHeight / 2

    const anchorScale = anchorRect.width / img.naturalWidth
    const targetZ = Math.log2(anchorScale / this._baseScale)

    // Set bounds to target so spring pulls toward it
    this._boundsX.min = targetX
    this._boundsX.max = targetX
    this._boundsY.min = targetY
    this._boundsY.max = targetY
    this._boundsScale.min = targetZ
    this._boundsScale.max = targetZ

    console.log("[Spektra] collapse target:", {
      anchorLeft: anchorRect.left.toFixed(2),
      anchorTop: anchorRect.top.toFixed(2),
      anchorWidth: anchorRect.width.toFixed(2),
      anchorHeight: anchorRect.height.toFixed(2),
      containerW: this._containerWidth.toFixed(2),
      containerH: this._containerHeight.toFixed(2),
      targetX: targetX.toFixed(2),
      targetY: targetY.toFixed(2),
      targetZ: targetZ.toFixed(2),
    })
  }

  public toggle(): void {
    this._mode === "expanded" ? this.collapse() : this.expand()
  }

  private setupDoubleTap(): void {
    if (this._options?.doubleTapZoom === false) return
    if (!this._imgEl) return

    this._imgEl.addEventListener("dblclick", (e: MouseEvent) => {
      e.preventDefault()
      this.togglePresetZoom()
    })
  }

  public togglePresetZoom(): void {
    if (
      !this._kinetic ||
      !this._helm ||
      this._isTransitioning ||
      !this._el ||
      !this._img
    )
      return

    const zoomLevel = this._options?.doubleTapZoomLevel ?? 0.75
    const targetZ = this._boundsScale.max * zoomLevel
    const isZoomedIn = this._kinetic.position.z > targetZ * 0.5
    const rect = this._el.getBoundingClientRect()

    this._isTransitioning = true

    if (isZoomedIn) {
      this._helm.mapper.updatePointer(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        "mouse"
      )

      this._boundsX.min = 0
      this._boundsX.max = 0
      this._boundsY.min = 0
      this._boundsY.max = 0
      this._boundsScale.min = 0
      this._boundsScale.max = 0
    } else {
      const pointer = this._helm.mapper.pointer

      if (pointer.x === 0 && pointer.y === 0) {
        this._helm.mapper.updatePointer(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          "mouse"
        )
      }

      this._cachedZoomOrigin = this.getPointerRelative()

      this._boundsX.min = -Infinity
      this._boundsX.max = Infinity
      this._boundsY.min = -Infinity
      this._boundsY.max = Infinity
      this._boundsScale.min = targetZ
      this._boundsScale.max = targetZ
    }
  }

  private onTransitionComplete(): void {
    this._isTransitioning = false
    this._cachedZoomOrigin = null

    if (this._mode === "expanded") {
      this._boundsScale = new Bounds({
        min: (this._options?.minScale ?? 0.5) - 1,
        max: (this._options?.maxScale ?? 5) - 1,
      })

      const kinetic = this._kinetic
      if (kinetic) {
        // Only reset position if we transitioned to centre
        if (
          Math.abs(kinetic.position.x) < 0.01 &&
          Math.abs(kinetic.position.y) < 0.01 &&
          Math.abs(kinetic.position.z) < 0.01
        ) {
          kinetic.position.set(0, 0, 0)
        }
        kinetic.velocity.set(0, 0, 0)
      }

      this._helm?.resume()
      this.applyTransform()

      this._options?.onExpandEnd?.()
    } else if (this._mode === "collapsing") {
      this._mode = "inline"
      Spektra._expanded = null

      this._el?.classList.add("spektra-ignore")

      this.showAnchor(() => {
        this._el?.classList.remove("spektra-expanded")
        this._el?.classList.remove("spektra-ignore")
        this._kinetic?.reset()

        this._boundsScale = new Bounds({
          min: (this._options?.minScale ?? 0.5) - 1,
          max: (this._options?.maxScale ?? 5) - 1,
        })

        this._options?.onCollapseEnd?.()
      })
    }
  }

  private injectStyles(): void {
    if (Spektra._styleInjected) return
    const style = document.createElement("style")
    style.textContent = styles
    document.head.appendChild(style)
    Spektra._styleInjected = true
  }

  public static destroy(selector: string): void {
    const el = document.querySelector(selector) as HTMLElement
    el?.__spektra?.dispose()
    if (el) el.__spektra = undefined
  }

  public dispose(): void {
    if (!this._el) return
    if (Spektra._expanded === this) Spektra._expanded = null
    this._el.__spektra = undefined

    this.cancelFrame()

    if (this._onBackgroundClick) {
      this._el.removeEventListener("click", this._onBackgroundClick)
      this._onBackgroundClick = null
    }

    this._overlay?.remove()
    this._overlay = null

    this._anchor?.remove()
    this._anchor = null

    this._resizeObserver?.disconnect()
    this._resizeObserver = null

    this._kinetic?.reset()
    this._kinetic = null

    this._helm?.dispose()
    this._helm = null

    this._el?.remove()
    this._el = null
    this._img = null
    this._options = null
  }
}
