import { DebugShapes, Mat4, Material, Node3D as Node3DClass, Quaternion, Ray, Vector3, Visual, boxGeometry, cylinderGeometry, mergeGeometry, torusGeometry, type Catalyst, type Geometry, type Node3D, type ViewPose } from "@nickpaustian/catalyst"
import { pickMesh } from "@nickpaustian/obelisk"

const CLICK_DISTANCE = 4
const CLICK_MS = 400
const HANDLE_PIXELS = 10
const ORBIT_SPEED = 0.005
const MIN_DISTANCE = 0.2
const MAX_DISTANCE = 400
const GIZMO_SCREEN_SIZE = 0.16
const RING_SEGMENTS = 48

export type PickMode = "replace" | "toggle"

/** A rectangle on the page, in client coordinates. */
export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

const screenRect = (from: { x: number; y: number }, to: { clientX: number; clientY: number }): ScreenRect => ({
  left: Math.min(from.x, to.clientX),
  top: Math.min(from.y, to.clientY),
  right: Math.max(from.x, to.clientX),
  bottom: Math.max(from.y, to.clientY),
})

export type GizmoMode = "translate" | "rotate" | "scale"
type Axis = "x" | "y" | "z"
/** A gizmo handle: an axis, or the centre cube that scales every axis at once. */
type Handle = Axis | "all"
/** What the viewport's pointer does besides selecting: nothing, or drawing a box or a collider volume on the ground. */
export type DrawTool = "box" | "collider"

/** A box the draw tool finished: its kind, centre and size in world units. */
export interface DrawnBox {
  kind: DrawTool
  centre: Vector3
  size: Vector3
}

/** Anything the gizmo can drive: a node, a control point, a marker. */
export interface GizmoTarget {
  position: () => Vector3
  rotation?: () => Quaternion
  apply: (position: Vector3, rotation: Quaternion) => void
  /** The per-axis size the scale gizmo multiplies: a box's dimensions, or a transform's scale. Without it the scale gizmo does nothing. */
  size?: () => Vector3
  resize?: (size: Vector3) => void
}

/** A node with dimensions of its own: a box or a box collider; the scale gizmo sizes those rather than the transform. */
export interface Sized {
  width: number
  height: number
  depth: number
  resize: (width: number, height: number, depth: number) => unknown
}

export const isSized = (node: object): node is Sized => {
  const n = node as Partial<Sized>
  return typeof n.width === "number" && typeof n.height === "number" && typeof n.depth === "number" && typeof n.resize === "function"
}

export const nodeTarget = (node: Node3D): GizmoTarget => ({
  position: () => node.transform.getWorldPosition(),
  rotation: () => node.transform.getWorldRotation(),
  apply: (position, rotation) => {
    node.transform.setWorldPosition(position)
    node.transform.setWorldRotation(rotation)
  },
  size: () => (isSized(node) ? new Vector3(node.width, node.height, node.depth) : node.transform.scale.clone()),
  resize: (size) => {
    if (isSized(node)) node.resize(size.x, size.y, size.z)
    else node.transform.scale.copy(size)
  },
})

/**
 * The gizmo sits on the active node and the whole group follows it: every
 * change to the pivot's world matrix is applied as the same delta to each node.
 */
export const groupTarget = (nodes: Node3D[], pivot: Node3D): GizmoTarget => ({
  position: () => pivot.transform.getWorldPosition(),
  rotation: () => pivot.transform.getWorldRotation(),
  apply: (position, rotation) => {
    const previous = pivot.transform.worldMatrix.clone()
    const next = new Mat4().composeTRS(position, rotation, pivot.transform.getWorldScale())
    const delta = new Mat4().multiply(next, new Mat4().invert(previous))
    for (const node of nodes) node.transform.setWorldMatrix(new Mat4().multiply(delta, node.transform.worldMatrix))
  },
})

const AXES: Record<Axis, Vector3> = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) }
const AXIS_COLOURS: Record<Axis, number> = { x: 0xff4d4d, y: 0x5ce06a, z: 0x4d8dff }
const HOVER_COLOUR = 0xffe14d
const UP = new Vector3(0, 1, 0)
const UNIT = new Vector3(1, 1, 1)

/** The handle for one axis: a shaft with a cone head for moving, a tube ring for turning, a shaft with a cube for sizing, built standing on y and turned onto its axis. */
const buildHandle = (mode: GizmoMode, axis: Axis): Geometry => {
  const onAxis = new Mat4().composeTRS(new Vector3(), new Quaternion().setFromUnitVectors(UP, AXES[axis]), UNIT)
  if (mode === "rotate") return mergeGeometry([{ mesh: torusGeometry(1, 0.022, 10, 64), matrix: onAxis }])
  const shaft = cylinderGeometry(0.016, 0.016, 0.8, 12)
  const head = mode === "scale" ? boxGeometry(0.13, 0.13, 0.13) : cylinderGeometry(0, 0.07, 0.24, 20)
  const along = (y: number) => new Mat4().multiply(onAxis, new Mat4().composeTRS(new Vector3(0, y, 0), new Quaternion(), UNIT))
  return mergeGeometry([
    { mesh: shaft, matrix: along(0.4) },
    { mesh: head, matrix: along(mode === "scale" ? 0.86 : 0.88) },
  ])
}

/** The cube at the pivot that scales all three axes together. */
const buildCentre = (): Geometry => boxGeometry(0.12, 0.12, 0.12)
const CENTRE_COLOUR = 0xd8dde6
/** The centre handle's reach on screen. */
const CENTRE_PIXELS = 9
/** Pixels of pointer travel that double a uniform scale. */
const SCALE_PIXELS = 120
/** The smallest size a drag leaves a box. */
const MIN_SIZE = 0.01

const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax, dy = by - ay
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len))
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

/**
 * Authoring camera: orbit around a point, with a transform gizmo that
 * writes back to the selected node. It is a pose the engine's view follows
 * while active, so the scene is drawn from it while the nodes keep their
 * own cameras.
 */
export class EditorCamera implements ViewPose {
  readonly position = new Vector3(6, 5, 8)
  readonly rotation = new Quaternion()
  fov = 50
  near = 0.05
  far = 500
  private readonly centre = new Vector3(0, 0.5, 0)
  private yaw = 0
  private pitch = 0
  private distance = 8
  private target: GizmoTarget | null = null
  private active = false
  private previousTarget: ViewPose | Node3D | null = null
  private unsubscribe: (() => void) | null = null
  private onChanged: (() => void) | null = null
  private readonly engine: Catalyst
  private readonly canvas: HTMLCanvasElement
  private gizmoMode: GizmoMode = "translate"
  private centre3: Visual | null = null
  private readonly centreMaterial = new Material({ colour: CENTRE_COLOUR })
  private drawTool: DrawTool | null = null
  private drawing: { phase: "footprint" | "height"; a: Vector3; b: Vector3; height: number; preview: Visual } | null = null
  /** Called with the box a draw finished. */
  onDrawBox: ((box: DrawnBox) => void) | null = null
  private gizmo: Record<Axis, Visual> | null = null
  private readonly handleMaterials: Record<Axis, Material> = { x: new Material({ colour: AXIS_COLOURS.x, name: "gizmo x" }), y: new Material({ colour: AXIS_COLOURS.y, name: "gizmo y" }), z: new Material({ colour: AXIS_COLOURS.z, name: "gizmo z" }) }
  private hovered: Handle | null = null
  private snapMove: number | null = null
  private snapRotate: number | null = null
  private readonly pivotPosition = new Vector3()
  private readonly pivotRotation = new Quaternion()
  /** A gizmo drag began or ended; an editor records the whole drag as one change. */
  onDrag: ((dragging: boolean) => void) | null = null
  /** A click on the canvas that was not a drag or a gizmo handle: where, and whether a modifier asked to add. */
  onClick: ((x: number, y: number, mode: PickMode) => void) | null = null
  /** A shift-drag on the canvas finished: the rectangle it covered, in client coordinates, and whether cmd or ctrl asked to add to the selection. */
  onMarquee: ((rect: ScreenRect, add: boolean) => void) | null = null
  private press: { x: number; y: number; at: number; button: number } | null = null
  private marquee: { x: number; y: number; add: boolean; box: HTMLDivElement | null } | null = null
  private orbiting: { kind: "orbit" | "pan"; x: number; y: number } | null = null
  private drag: { axis: Handle; startValue: number; position: Vector3; rotation: Quaternion; size: Vector3 | null } | null = null
  private sizedFlag = false
  private readonly ray = new Ray()

  constructor(engine: Catalyst) {
    this.engine = engine
    if (!engine.canvas) throw new Error("[catalyst-editor] the editor camera needs the engine's canvas")
    this.canvas = engine.canvas
    this.lookFrom(this.position, this.centre)
  }

  get isActive(): boolean {
    return this.active
  }

  /** Where the orbit is centred; a sensible place to drop new nodes. */
  get orbitTarget(): Vector3 {
    return this.centre.clone()
  }

  /** Make this the rendering camera and start orbiting. */
  activate(): void {
    if (this.active) return
    const engine = this.engine
    this.previousTarget = engine.camera.target as ViewPose | Node3D | null
    engine.camera.target = this
    const canvas = this.canvas
    canvas.addEventListener("pointerdown", this.onPointerDown, true)
    canvas.addEventListener("pointermove", this.onHover)
    canvas.addEventListener("wheel", this.onWheel, { passive: false })
    canvas.addEventListener("contextmenu", this.onContextMenu)
    const unsubscribeRender = engine.signals.onRender.subscribe(() => this.placeGizmo(), 45)
    this.unsubscribe = () => {
      unsubscribeRender()
      canvas.removeEventListener("pointerdown", this.onPointerDown, true)
      canvas.removeEventListener("pointermove", this.onHover)
      this.unlistenPress()
      canvas.removeEventListener("wheel", this.onWheel)
      canvas.removeEventListener("contextmenu", this.onContextMenu)
    }
    this.active = true
    if (this.gizmo) for (const visual of Object.values(this.gizmo)) engine.scene.add(visual)
    if (this.centre3) engine.scene.add(this.centre3)
  }

  /** Hand rendering back to whatever camera was active before. */
  deactivate(): void {
    if (!this.active) return
    this.detach()
    this.unsubscribe?.()
    this.unsubscribe = null
    this.engine.camera.target = this.previousTarget as any
    this.active = false
  }

  //=========================
  // The orbit
  //=========================

  /** Place the camera at `from` looking at `at`, and orbit about `at` from there. */
  private lookFrom(from: Vector3, at: Vector3): void {
    const offset = from.clone().subVector(at)
    this.distance = Math.max(MIN_DISTANCE, offset.length())
    this.yaw = Math.atan2(offset.x, offset.z)
    this.pitch = Math.asin(Math.max(-1, Math.min(1, offset.y / this.distance)))
    this.centre.copy(at)
    this.updatePose()
  }

  /** The pose from the orbit: a camera pitched and turned, backed off from the centre along its own +z. */
  private updatePose(): void {
    this.rotation.setFromEuler(-this.pitch, this.yaw, 0, "YXZ")
    const back = new Vector3(0, 0, 1).applyQuaternion(this.rotation)
    this.position.copy(this.centre).addScaled(back, this.distance)
  }

  /** Orbit around a world position, keeping the viewing direction. */
  focusPoint(target: Vector3, distance = 2.5): void {
    this.centre.copy(target)
    this.distance = Math.max(MIN_DISTANCE, distance)
    this.updatePose()
  }

  focus(node: Node3D, distance = 2.5): void {
    this.focusPoint(node.transform.getWorldPosition(), distance)
  }

  /** The wheel zooms; with shift held (or a trackpad's two-finger scroll with shift) it pans. A pinch arrives as a wheel with ctrl and zooms. */
  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    if (event.shiftKey && !event.ctrlKey) return this.panBy(-event.deltaX, -event.deltaY)
    this.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, this.distance * Math.exp(event.deltaY * (event.ctrlKey ? 0.01 : 0.0015))))
    this.updatePose()
  }

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault()
  }

  private orbitBy(dx: number, dy: number): void {
    this.yaw -= dx * ORBIT_SPEED
    this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch + dy * ORBIT_SPEED))
    this.updatePose()
  }

  private panBy(dx: number, dy: number): void {
    const rect = this.canvas.getBoundingClientRect()
    const worldPerPixel = (2 * this.distance * Math.tan((this.fov * Math.PI) / 360)) / Math.max(1, rect.height)
    const right = new Vector3(1, 0, 0).applyQuaternion(this.rotation)
    const up = new Vector3(0, 1, 0).applyQuaternion(this.rotation)
    this.centre.addScaled(right, -dx * worldPerPixel).addScaled(up, dy * worldPerPixel)
    this.updatePose()
  }

  //=========================
  // Pointer
  //=========================

  private screenToUv(clientX: number, clientY: number): { u: number; v: number } {
    const rect = this.canvas.getBoundingClientRect()
    return { u: (clientX - rect.left) / Math.max(1, rect.width), v: (clientY - rect.top) / Math.max(1, rect.height) }
  }

  private rayAt(clientX: number, clientY: number): Ray {
    const { u, v } = this.screenToUv(clientX, clientY)
    return this.engine.camera.rayAt(u, v, this.ray)
  }

  /**
   * While a button is down the move and the release are heard on the window,
   * whichever element holds the pointer capture (the engine's input captures
   * on the canvas too), and a cancelled pointer or a lost window ends the press.
   */
  private listenPress(): void {
    window.addEventListener("pointermove", this.onPointerMove)
    window.addEventListener("pointerup", this.onPointerUp, true)
    window.addEventListener("pointercancel", this.onPointerUp, true)
    window.addEventListener("blur", this.onPressLost)
  }

  private unlistenPress(): void {
    window.removeEventListener("pointermove", this.onPointerMove)
    window.removeEventListener("pointerup", this.onPointerUp, true)
    window.removeEventListener("pointercancel", this.onPointerUp, true)
    window.removeEventListener("blur", this.onPressLost)
  }

  private readonly onPressLost = (): void => {
    if (this.drawing) return this.cancelDraw()
    const dragging = this.drag !== null
    this.press = null
    this.marquee?.box?.remove()
    this.marquee = null
    this.orbiting = null
    this.unlistenPress()
    if (dragging) this.endDrag()
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.drawTool && event.button === 0) {
      event.stopImmediatePropagation()
      if (this.drawing) return this.stepDraw()
      if (this.beginDraw(event.clientX, event.clientY)) this.listenPress()
      return
    }
    const handle = event.button === 0 ? this.handleAt(event.clientX, event.clientY) : null
    if (handle) {
      event.stopImmediatePropagation()
      this.canvas.setPointerCapture(event.pointerId)
      this.listenPress()
      this.beginDrag(handle, event.clientX, event.clientY)
      return
    }
    const free = event.button === 0
    this.press = free ? { x: event.clientX, y: event.clientY, at: performance.now(), button: event.button } : null
    this.canvas.setPointerCapture(event.pointerId)
    this.listenPress()
    if (free && event.shiftKey) {
      this.marquee = { x: event.clientX, y: event.clientY, add: event.metaKey || event.ctrlKey, box: null }
      return
    }
    // The left button orbits, or pans with option (alt) held; the right and middle buttons pan.
    this.orbiting = { kind: event.button === 0 && !event.altKey ? "orbit" : "pan", x: event.clientX, y: event.clientY }
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.drawing) return this.moveDraw(event.clientX, event.clientY)
    if (this.drag) return this.moveDrag(event.clientX, event.clientY)
    const marquee = this.marquee
    if (marquee) {
      if (!marquee.box) {
        if (Math.hypot(event.clientX - marquee.x, event.clientY - marquee.y) <= CLICK_DISTANCE) return
        marquee.box = document.createElement("div")
        marquee.box.className = "marquee"
        this.canvas.parentElement?.appendChild(marquee.box)
      }
      const rect = this.canvas.getBoundingClientRect()
      const area = screenRect(marquee, event)
      Object.assign(marquee.box.style, { left: `${area.left - rect.left}px`, top: `${area.top - rect.top}px`, width: `${area.right - area.left}px`, height: `${area.bottom - area.top}px` })
      return
    }
    const orbiting = this.orbiting
    if (!orbiting) return
    const dx = event.clientX - orbiting.x, dy = event.clientY - orbiting.y
    orbiting.x = event.clientX
    orbiting.y = event.clientY
    if (orbiting.kind === "orbit") this.orbitBy(dx, dy)
    else this.panBy(dx, dy)
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    // The footprint ends with the release; the height phase keeps hearing moves until the next click.
    if (this.drawing) {
      if (this.drawing.phase === "footprint") this.stepDraw()
      return
    }
    const press = this.press
    const marquee = this.marquee
    const dragging = this.drag !== null
    this.press = null
    this.marquee = null
    this.orbiting = null
    this.unlistenPress()
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    if (dragging) {
      this.endDrag()
      return
    }
    if (marquee?.box) {
      marquee.box.remove()
      this.onMarquee?.(screenRect(marquee, event), marquee.add)
      return
    }
    if (!press || event.button !== 0) return
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_DISTANCE || performance.now() - press.at > CLICK_MS) return
    this.onClick?.(event.clientX, event.clientY, event.metaKey || event.ctrlKey || event.shiftKey ? "toggle" : "replace")
  }

  private readonly onHover = (event: PointerEvent): void => {
    if (this.drawTool) return
    if (this.drag || this.orbiting || this.marquee) return
    const axis = this.handleAt(event.clientX, event.clientY)
    if (axis !== this.hovered) {
      this.hovered = axis
      this.colourGizmo()
    }
    this.canvas.style.cursor = axis ? "grab" : ""
  }

  //=========================
  // Picking
  //=========================

  /**
   * The scene node under a point on the canvas: the nearest hit among the
   * mesh visuals nodes under `root` have attached (a prefab's or primitive's
   * internals count for their owner), or, for a node with no mesh (a light,
   * a camera, an empty), a small sphere about its origin that stays about
   * `HANDLE_PIXELS` across on screen. Null for empty space. The gizmo and
   * the grid are lines and never hits.
   */
  pick(clientX: number, clientY: number, root: Node3D): Node3D | null {
    const ray = this.rayAt(clientX, clientY)
    const rect = this.canvas.getBoundingClientRect()
    const worldPerPixel = (2 * Math.tan((this.fov * Math.PI) / 360)) / Math.max(1, rect.height)
    let best: { node: Node3D; t: number } | null = null
    const consider = (node: Node3D, t: number) => {
      if (!best || t < best.t) best = { node, t }
    }
    root.walk((node) => {
      if (!(node instanceof Node3DClass) || node === root || !node.isVisible) return
      let meshes = 0
      for (const visual of node.attachedObjects) {
        if (visual.isLines || !visual.visible) continue
        meshes++
        const hit = pickMesh(visual.geometry as Geometry, visual.matrix, ray)
        if (hit) consider(node, hit.t)
      }
      if (meshes > 0 || node.internal) return
      // No mesh to hit: a sphere about the origin, a steady size on screen.
      const origin = node.getWorldPosition()
      const radius = Math.max(0.05, (HANDLE_PIXELS * 1.4) * worldPerPixel * origin.distanceTo(this.position))
      const t = ray.intersectSphere(origin, radius)
      if (t !== null) consider(node, t)
    })
    if (!best) return null
    let node: Node3D | null = (best as { node: Node3D }).node
    while (node && node.internal) node = node.parent instanceof Node3DClass ? node.parent : null
    return node && node !== root ? node : null
  }

  /** The nodes under `root` whose world position lands inside a rectangle on the canvas, in front of the camera; a node's internals count for their owner and are not listed. */
  nodesIn(rect: ScreenRect, root: Node3D): Node3D[] {
    const bounds = this.canvas.getBoundingClientRect()
    const inside: Node3D[] = []
    root.walk((node) => {
      if (!(node instanceof Node3DClass) || node === root || node.internal) return
      const p = this.engine.camera.project(node.transform.getWorldPosition())
      if (p.depth <= this.near) return
      const x = bounds.left + p.u * bounds.width
      const y = bounds.top + p.v * bounds.height
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) inside.push(node)
    })
    return inside
  }

  //=========================
  // The gizmo
  //=========================

  /** Put the gizmo on a node. */
  attach(node: Node3D, onChanged?: () => void): void {
    this.sizedFlag = isSized(node)
    this.attachTarget(nodeTarget(node), onChanged)
    this.sizedFlag = isSized(node)
  }

  attachTarget(target: GizmoTarget, onChanged?: () => void): void {
    this.sizedFlag = false
    this.target = target
    this.onChanged = onChanged ?? null
    this.syncFromTarget()
    if (!this.gizmo) {
      this.gizmo = this.buildGizmo()
      if (this.active) for (const visual of Object.values(this.gizmo)) this.engine.scene.add(visual)
    }
    this.placeGizmo()
  }

  private buildGizmo(): Record<Axis, Visual> {
    const make = (axis: Axis) => {
      const visual = new Visual(buildHandle(this.gizmoMode, axis), this.handleMaterials[axis])
      visual.overlay = true
      return visual
    }
    this.colourGizmo()
    this.buildCentre()
    return { x: make("x"), y: make("y"), z: make("z") }
  }

  /** The centre cube exists in scale mode only. */
  private buildCentre(): void {
    if (this.centre3) {
      this.engine.scene.remove(this.centre3)
      this.engine.renderer?.release(this.centre3.geometry)
      this.centre3 = null
    }
    if (this.gizmoMode !== "scale") return
    this.centre3 = new Visual(buildCentre(), this.centreMaterial)
    this.centre3.overlay = true
    if (this.active && this.gizmo) this.engine.scene.add(this.centre3)
  }

  /** The hovered handle in the highlight colour, the rest in their axis colours. */
  private colourGizmo(): void {
    for (const axis of ["x", "y", "z"] as Axis[]) this.handleMaterials[axis].setColour(axis === this.hovered ? HOVER_COLOUR : AXIS_COLOURS[axis])
    this.centreMaterial.setColour(this.hovered === "all" ? HOVER_COLOUR : CENTRE_COLOUR)
  }

  detach(): void {
    if (this.gizmo) {
      for (const visual of Object.values(this.gizmo)) {
        this.engine.scene.remove(visual)
        this.engine.renderer?.release(visual.geometry)
      }
      this.gizmo = null
    }
    if (this.centre3) {
      this.engine.scene.remove(this.centre3)
      this.engine.renderer?.release(this.centre3.geometry)
      this.centre3 = null
    }
    this.target = null
    this.onChanged = null
    this.hovered = null
    this.canvas.style.cursor = ""
  }

  /** Refresh the pivot after the target moved by other means: panel fields, code. */
  syncFromTarget(): void {
    if (!this.target) return
    this.pivotPosition.copy(this.target.position())
    const rotation = this.target.rotation?.()
    if (rotation) this.pivotRotation.copy(rotation)
    else this.pivotRotation.identity()
  }

  set mode(mode: GizmoMode) {
    if (this.gizmoMode === mode) return
    this.gizmoMode = mode
    this.rebuildGizmo()
  }

  /** Snap gizmo moves to a grid and turns to an angle; null for free. */
  setSnap(move: number | null, rotateDegrees: number | null): void {
    this.snapMove = move
    this.snapRotate = rotateDegrees === null ? null : (rotateDegrees * Math.PI) / 180
  }

  private rebuildGizmo(): void {
    if (!this.gizmo) return
    for (const axis of ["x", "y", "z"] as Axis[]) {
      const visual = this.gizmo[axis]
      this.engine.renderer?.release(visual.geometry)
      visual.geometry = buildHandle(this.gizmoMode, axis)
    }
    this.buildCentre()
    this.placeGizmo()
  }

  /** The gizmo at the pivot, world-aligned, scaled to a steady size on screen. */
  private placeGizmo(): void {
    if (!this.gizmo) return
    const scale = this.gizmoScale()
    for (const visual of Object.values(this.gizmo)) visual.matrix.composeTRS(this.pivotPosition, IDENTITY, new Vector3(scale, scale, scale))
    this.centre3?.matrix.composeTRS(this.pivotPosition, IDENTITY, new Vector3(scale, scale, scale))
  }

  //=========================
  // Drawing boxes
  //=========================

  /** Which draw tool the pointer uses, or null to select and drag as usual. */
  get tool(): DrawTool | null {
    return this.drawTool
  }

  set tool(tool: DrawTool | null) {
    if (tool === this.drawTool) return
    this.cancelDraw()
    this.drawTool = tool
    this.canvas.style.cursor = tool ? "crosshair" : ""
  }

  get isDrawing(): boolean {
    return this.drawing !== null
  }

  /** Where the pointer's ray meets the ground plane, snapped to the move grid; null when it looks away from it. */
  private groundHit(clientX: number, clientY: number): Vector3 | null {
    const ray = this.rayAt(clientX, clientY)
    const hit = new Vector3()
    if (ray.intersectPlane(new Vector3(0, 0, 0), UP, hit) === null) return null
    return this.snapPoint(hit)
  }

  private snapPoint(point: Vector3): Vector3 {
    const snap = this.snapMove
    if (!snap) return point
    return point.set(Math.round(point.x / snap) * snap, Math.round(point.y / snap) * snap, Math.round(point.z / snap) * snap)
  }

  private beginDraw(clientX: number, clientY: number): boolean {
    const a = this.groundHit(clientX, clientY)
    if (!a) return false
    const preview = DebugShapes.box({ width: 1, height: 1, depth: 1, colour: this.drawTool === "collider" ? 0xffa64d : 0xffe14d })
    this.engine.scene.add(preview)
    this.drawing = { phase: "footprint", a, b: a.clone(), height: 0, preview }
    this.placePreview()
    return true
  }

  /** Footprint: the far corner follows the pointer on the ground. Height: the pointer's rise on a vertical plane through the corner it released on, facing the camera, so the top follows the pointer. */
  private moveDraw(clientX: number, clientY: number): void {
    const drawing = this.drawing
    if (!drawing) return
    if (drawing.phase === "footprint") {
      const b = this.groundHit(clientX, clientY)
      if (b) drawing.b.copy(b)
    } else {
      const ray = this.rayAt(clientX, clientY)
      const forward = new Vector3(0, 0, -1).applyQuaternion(this.rotation)
      const normal = new Vector3(forward.x, 0, forward.z)
      if (normal.length() < 1e-6) return
      normal.normalize()
      const hit = new Vector3()
      if (ray.intersectPlane(drawing.b, normal, hit) === null) return
      let height = Math.max(0, hit.y)
      if (this.snapMove) height = Math.round(height / this.snapMove) * this.snapMove
      drawing.height = height
    }
    this.placePreview()
  }

  /** After the footprint, the height; after the height, the box. */
  private stepDraw(): void {
    const drawing = this.drawing
    if (!drawing) return
    if (drawing.phase === "footprint") {
      const size = this.drawSize()
      // A click without a drag is not a box.
      if (size.x < MIN_SIZE || size.z < MIN_SIZE) return this.cancelDraw()
      drawing.phase = "height"
      drawing.height = this.snapMove ?? 1
      this.placePreview()
      return
    }
    const size = this.drawSize()
    const centre = drawing.a.clone().addVector(drawing.b).scale(0.5)
    centre.y = size.y / 2
    const kind = this.drawTool ?? "box"
    this.cancelDraw()
    this.onDrawBox?.({ kind, centre, size })
  }

  private drawSize(): Vector3 {
    const d = this.drawing!
    return new Vector3(Math.abs(d.b.x - d.a.x), Math.max(d.height, d.phase === "height" ? MIN_SIZE : 0), Math.abs(d.b.z - d.a.z))
  }

  private placePreview(): void {
    const drawing = this.drawing
    if (!drawing) return
    const size = this.drawSize()
    const centre = drawing.a.clone().addVector(drawing.b).scale(0.5)
    centre.y = size.y / 2
    // The preview is a unit box: scaled to the size, flat while only the footprint is drawn.
    drawing.preview.matrix.composeTRS(centre, IDENTITY, new Vector3(Math.max(size.x, 1e-4), Math.max(size.y, 1e-4), Math.max(size.z, 1e-4)))
  }

  cancelDraw(): void {
    const drawing = this.drawing
    if (!drawing) return
    this.engine.scene.remove(drawing.preview)
    this.engine.renderer?.release(drawing.preview.geometry)
    this.drawing = null
    this.unlistenPress()
  }

  private gizmoScale(): number {
    return Math.max(0.01, this.position.distanceTo(this.pivotPosition) * GIZMO_SCREEN_SIZE)
  }

  /** The handle under a point on the canvas, by distance on screen to its lines; the centre cube first in scale mode. */
  private handleAt(clientX: number, clientY: number): Handle | null {
    if (!this.gizmo || !this.target) return null
    const rect = this.canvas.getBoundingClientRect()
    const toScreen = (p: Vector3): [number, number] | null => {
      const s = this.engine.camera.project(p)
      if (s.depth <= this.near) return null
      return [rect.left + s.u * rect.width, rect.top + s.v * rect.height]
    }
    const scale = this.gizmoScale()
    if (this.gizmoMode === "scale") {
      const centre = toScreen(this.pivotPosition)
      if (centre && Math.hypot(clientX - centre[0], clientY - centre[1]) <= CENTRE_PIXELS) return "all"
    }
    let best: { axis: Axis; distance: number } | null = null
    for (const axis of ["x", "y", "z"] as Axis[]) {
      const a = AXES[axis]
      let distance = Infinity
      if (this.gizmoMode !== "rotate") {
        const from = toScreen(this.pivotPosition)
        const to = toScreen(this.pivotPosition.clone().addScaled(a, scale))
        if (from && to) distance = distanceToSegment(clientX, clientY, from[0], from[1], to[0], to[1])
      } else {
        const u = axis === "x" ? AXES.y : AXES.x
        const v = axis === "z" ? AXES.y : AXES.z
        let previous: [number, number] | null = null
        for (let i = 0; i <= RING_SEGMENTS; i++) {
          const t = (i / RING_SEGMENTS) * Math.PI * 2
          const point = this.pivotPosition.clone().addScaled(u, Math.cos(t) * scale).addScaled(v, Math.sin(t) * scale)
          const s = toScreen(point)
          if (s && previous) distance = Math.min(distance, distanceToSegment(clientX, clientY, previous[0], previous[1], s[0], s[1]))
          previous = s
        }
      }
      if (distance <= HANDLE_PIXELS && (!best || distance < best.distance)) best = { axis, distance }
    }
    return best?.axis ?? null
  }

  private beginDrag(axis: Handle, clientX: number, clientY: number): void {
    this.syncFromTarget()
    this.drag = { axis, startValue: this.dragValue(axis, clientX, clientY) ?? 0, position: this.pivotPosition.clone(), rotation: this.pivotRotation.clone(), size: this.target?.size?.() ?? null }
    this.canvas.style.cursor = "grabbing"
    this.onDrag?.(true)
  }

  /** Where the pointer is along the handle: the parameter along a translate or scale axis, the angle around a rotate axis, or the pointer's travel for the centre cube. */
  private dragValue(axis: Handle, clientX: number, clientY: number): number | null {
    const ray = this.rayAt(clientX, clientY)
    if (axis === "all") return clientX - clientY
    const a = AXES[axis]
    const p = this.drag?.position ?? this.pivotPosition
    if (this.gizmoMode !== "rotate") {
      // The closest point of the pointer ray to the axis line, as a distance along the axis (Ericson's closest points of two lines).
      const r = p.clone().subVector(ray.origin)
      const b = a.dot(ray.direction)
      const d = a.dot(r), e = ray.direction.dot(r)
      const denominator = 1 - b * b
      if (Math.abs(denominator) < 1e-6) return null
      return (b * e - d) / denominator
    }
    const hit = new Vector3()
    if (ray.intersectPlane(p, a, hit) === null) return null
    const u = axis === "x" ? AXES.y : AXES.x
    const v = axis === "z" ? AXES.y : AXES.z
    const local = hit.subVector(p)
    return Math.atan2(local.dot(v), local.dot(u))
  }

  private moveDrag(clientX: number, clientY: number): void {
    const drag = this.drag
    if (!drag || !this.target) return
    const value = this.dragValue(drag.axis, clientX, clientY)
    if (value === null) return
    if (this.gizmoMode === "scale") return this.scaleDrag(drag.axis, value)
    if (drag.axis === "all") return
    const a = AXES[drag.axis]
    if (this.gizmoMode === "translate") {
      let delta = value - drag.startValue
      if (this.snapMove) {
        const next = drag.position.clone().addScaled(a, delta)
        const snapped = Math.round(next.dot(a) / this.snapMove) * this.snapMove
        delta += snapped - next.dot(a)
      }
      this.pivotPosition.copy(drag.position).addScaled(a, delta)
      this.pivotRotation.copy(drag.rotation)
    } else {
      let angle = value - drag.startValue
      if (this.snapRotate) angle = Math.round(angle / this.snapRotate) * this.snapRotate
      this.pivotRotation.copy(drag.rotation).premultiply(new Quaternion().setFromAxisAngle(a, angle))
      this.pivotPosition.copy(drag.position)
    }
    this.target.apply(this.pivotPosition, this.pivotRotation)
    this.placeGizmo()
    this.onChanged?.()
  }

  /** An axis handle adds one to the factor per gizmo length the pointer travels along it; the centre cube doubles all three per `SCALE_PIXELS` of travel. */
  private scaleDrag(axis: Handle, value: number): void {
    const drag = this.drag
    if (!drag || !drag.size || !this.target?.resize) return
    const factor = axis === "all" ? Math.pow(2, (value - drag.startValue) / SCALE_PIXELS) : Math.max(0, 1 + (value - drag.startValue) / this.gizmoScale())
    const factors = axis === "all" ? new Vector3(factor, factor, factor) : new Vector3(1, 1, 1)
    if (axis !== "all") factors[axis] = factor
    const size = new Vector3(drag.size.x * factors.x, drag.size.y * factors.y, drag.size.z * factors.z)
    const snap = this.snapMove
    const snapped = (n: number) => (snap && this.sizedTarget ? Math.max(snap, Math.round(n / snap) * snap) : Math.max(MIN_SIZE, n))
    size.set(snapped(size.x), snapped(size.y), snapped(size.z))
    this.target.resize(size)
    this.onChanged?.()
  }

  /** Whether the target sizes a box rather than a transform; sizes snap to the move grid then. */
  private get sizedTarget(): boolean {
    return this.sizedFlag
  }

  private endDrag(): void {
    this.drag = null
    this.canvas.style.cursor = this.hovered ? "grab" : ""
    this.onDrag?.(false)
  }

  dispose(): void {
    this.deactivate()
  }
}

const IDENTITY = new Quaternion()
