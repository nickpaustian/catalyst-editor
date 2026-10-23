import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js"
import { Node3D as Node3DClass, type Catalyst, type Node3D } from "@nickpaustian/catalyst"

const CLICK_DISTANCE = 4
const CLICK_MS = 400

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

export type GizmoMode = "translate" | "rotate"

/** Anything the gizmo can drive: a node, a control point, a marker. */
export interface GizmoTarget {
  position: () => THREE.Vector3
  rotation?: () => THREE.Quaternion
  apply: (position: THREE.Vector3, rotation: THREE.Quaternion) => void
}

export const nodeTarget = (node: Node3D): GizmoTarget => ({
  position: () => node.transform.getWorldPosition(),
  rotation: () => node.transform.getWorldRotation(),
  apply: (position, rotation) => {
    node.transform.setWorldPosition(position)
    node.transform.setWorldRotation(rotation)
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
    const next = new THREE.Matrix4().compose(position, rotation, pivot.transform.getWorldScale())
    const delta = next.multiply(previous.invert())
    for (const node of nodes) node.transform.setWorldMatrix(delta.clone().multiply(node.transform.worldMatrix))
  },
})

/**
 * Authoring camera: orbit around a point, with a transform gizmo on a proxy
 * object that writes back to the selected node. The engine renders through
 * whatever its view targets, so this hands it a plain three.js camera.
 */
export class EditorCamera {
  readonly view: THREE.PerspectiveCamera
  private readonly orbit: OrbitControls
  private readonly gizmo: TransformControls
  private readonly proxy = new THREE.Object3D()
  private target: GizmoTarget | null = null
  private active = false
  private previousTarget: THREE.Camera | null = null
  private unsubscribe: (() => void) | null = null
  private onChanged: (() => void) | null = null
  private readonly engine: Catalyst
  /** A gizmo drag began or ended; an editor records the whole drag as one change. */
  onDrag: ((dragging: boolean) => void) | null = null
  /** A click on the canvas that was not a drag or a gizmo handle: where, and whether a modifier asked to add. */
  onClick: ((x: number, y: number, mode: PickMode) => void) | null = null
  /** A shift-drag on the canvas finished: the rectangle it covered, in client coordinates, and whether cmd or ctrl asked to add to the selection. */
  onMarquee: ((rect: ScreenRect, add: boolean) => void) | null = null
  private readonly raycaster = new THREE.Raycaster()
  private press: { x: number; y: number; at: number; button: number } | null = null
  private marquee: { x: number; y: number; add: boolean; box: HTMLDivElement | null } | null = null
  private readonly onPointerDown = (event: PointerEvent): void => {
    const free = event.button === 0 && !this.gizmo.dragging && !this.gizmo.axis
    this.press = free ? { x: event.clientX, y: event.clientY, at: performance.now(), button: event.button } : null
    if (!free || !event.shiftKey) return
    this.marquee = { x: event.clientX, y: event.clientY, add: event.metaKey || event.ctrlKey, box: null }
    event.stopImmediatePropagation()
    const canvas = event.currentTarget as HTMLElement
    canvas.setPointerCapture(event.pointerId)
    canvas.addEventListener("pointermove", this.onPointerMove)
  }
  private readonly onPointerMove = (event: PointerEvent): void => {
    const marquee = this.marquee
    if (!marquee) return
    if (!marquee.box) {
      if (Math.hypot(event.clientX - marquee.x, event.clientY - marquee.y) <= CLICK_DISTANCE) return
      marquee.box = document.createElement("div")
      marquee.box.className = "marquee"
      this.engine.renderer?.domElement.parentElement?.appendChild(marquee.box)
    }
    const rect = this.engine.renderer!.domElement.getBoundingClientRect()
    const area = screenRect(marquee, event)
    Object.assign(marquee.box.style, { left: `${area.left - rect.left}px`, top: `${area.top - rect.top}px`, width: `${area.right - area.left}px`, height: `${area.bottom - area.top}px` })
  }
  private readonly onPointerUp = (event: PointerEvent): void => {
    const press = this.press
    const marquee = this.marquee
    this.press = null
    this.marquee = null
    if (marquee) {
      const canvas = event.currentTarget as HTMLElement
      canvas.removeEventListener("pointermove", this.onPointerMove)
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
      if (marquee.box) {
        marquee.box.remove()
        this.onMarquee?.(screenRect(marquee, event), marquee.add)
        return
      }
    }
    if (!press || event.button !== 0 || this.gizmo.dragging) return
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_DISTANCE || performance.now() - press.at > CLICK_MS) return
    this.onClick?.(event.clientX, event.clientY, event.metaKey || event.ctrlKey || event.shiftKey ? "toggle" : "replace")
  }

  constructor(engine: Catalyst) {
    this.engine = engine
    const renderer = engine.renderer
    if (!renderer) throw new Error("[catalyst-editor] the editor camera needs the engine's renderer")
    this.view = new THREE.PerspectiveCamera(50, engine.width / engine.height, 0.05, 500)
    this.view.position.set(6, 5, 8)
    this.orbit = new OrbitControls(this.view, renderer.domElement)
    this.orbit.target.set(0, 0.5, 0)
    this.orbit.enableDamping = true
    this.orbit.enabled = false
    this.gizmo = new TransformControls(this.view, renderer.domElement)
    this.gizmo.setSize(0.8)
    this.gizmo.addEventListener("dragging-changed", (event) => {
      this.orbit.enabled = this.active && !event.value
      this.onDrag?.(Boolean(event.value))
    })
    this.gizmo.addEventListener("objectChange", () => this.writeBack())
    engine.scene.add(this.proxy)
  }

  get isActive(): boolean {
    return this.active
  }

  /** Where the orbit is centred; a sensible place to drop new nodes. */
  get orbitTarget(): THREE.Vector3 {
    return this.orbit.target.clone()
  }

  /** Make this the rendering camera and start orbiting. */
  activate(): void {
    if (this.active) return
    const engine = this.engine
    const current = engine.camera.target
    this.previousTarget = current && "isCamera" in current ? (current as THREE.Camera) : (current as { view: THREE.Camera } | null)?.view ?? null
    engine.camera.target = this.view
    this.view.aspect = engine.width / engine.height
    this.view.updateProjectionMatrix()
    this.orbit.enabled = true
    engine.scene.add(this.gizmo.getHelper())
    engine.renderer!.domElement.addEventListener("pointerdown", this.onPointerDown, true)
    engine.renderer!.domElement.addEventListener("pointerup", this.onPointerUp, true)
    const unsubscribeRender = engine.signals.onUpdate.subscribe(() => this.orbit.update())
    const unsubscribeResize = engine.signals.onResize.subscribe(({ width, height }) => {
      this.view.aspect = width / height
      this.view.updateProjectionMatrix()
    })
    this.unsubscribe = () => {
      unsubscribeRender()
      unsubscribeResize()
    }
    this.active = true
  }

  /** Hand rendering back to whatever camera was active before. */
  deactivate(): void {
    if (!this.active) return
    this.orbit.enabled = false
    this.detach()
    this.engine.scene.remove(this.gizmo.getHelper())
    this.engine.renderer?.domElement.removeEventListener("pointerdown", this.onPointerDown, true)
    this.engine.renderer?.domElement.removeEventListener("pointerup", this.onPointerUp, true)
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.previousTarget) this.engine.camera.target = this.previousTarget
    this.active = false
  }

  /**
   * The scene node under a point on the canvas: the nearest hit among the
   * objects nodes under `root` have attached (a prefab's or primitive's
   * internals count for their owner), or null for empty space. The gizmo,
   * the grid and lights are never hits.
   */
  pick(clientX: number, clientY: number, root: Node3D): Node3D | null {
    const canvas = this.engine.renderer?.domElement
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    this.raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.view)
    const owners = new Map<THREE.Object3D, Node3D>()
    root.walk((node) => {
      if (node instanceof Node3DClass) for (const object of node.attachedObjects) owners.set(object, node)
    })
    const helper = this.gizmo.getHelper()
    const candidates = this.engine.scene.children.filter((object) => object !== helper && object !== this.proxy && !(object instanceof THREE.GridHelper) && !(object as THREE.Light).isLight)
    for (const hit of this.raycaster.intersectObjects(candidates, true)) {
      let object: THREE.Object3D | null = hit.object
      while (object && !owners.has(object)) object = object.parent
      if (!object) continue
      let node: Node3D | null = owners.get(object)!
      while (node && node.internal) node = node.parent instanceof Node3DClass ? node.parent : null
      if (node && node !== root) return node
    }
    return null
  }

  /** The nodes under `root` whose world position lands inside a rectangle on the canvas, in front of the camera; a node's internals count for their owner and are not listed. */
  nodesIn(rect: ScreenRect, root: Node3D): Node3D[] {
    const canvas = this.engine.renderer?.domElement
    if (!canvas) return []
    const bounds = canvas.getBoundingClientRect()
    const inside: Node3D[] = []
    const point = new THREE.Vector3()
    root.walk((node) => {
      if (!(node instanceof Node3DClass) || node === root || node.internal) return
      point.copy(node.transform.getWorldPosition()).project(this.view)
      if (point.z < -1 || point.z > 1) return
      const x = bounds.left + ((point.x + 1) / 2) * bounds.width
      const y = bounds.top + ((1 - point.y) / 2) * bounds.height
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) inside.push(node)
    })
    return inside
  }

  focus(node: Node3D, distance = 2.5): void {
    this.focusPoint(node.transform.getWorldPosition(), distance)
  }

  /** Put the gizmo on a node; the proxy mirrors its world transform. */
  attach(node: Node3D, onChanged?: () => void): void {
    this.attachTarget(nodeTarget(node), onChanged)
  }

  attachTarget(target: GizmoTarget, onChanged?: () => void): void {
    this.target = target
    this.onChanged = onChanged ?? null
    this.syncFromTarget()
    this.gizmo.attach(this.proxy)
  }

  detach(): void {
    this.gizmo.detach()
    this.target = null
    this.onChanged = null
  }

  /** Refresh the proxy after the target moved by other means: panel fields, code. */
  syncFromTarget(): void {
    if (!this.target) return
    this.proxy.position.copy(this.target.position())
    const rotation = this.target.rotation?.()
    if (rotation) this.proxy.quaternion.copy(rotation)
    else this.proxy.quaternion.identity()
  }

  /** Orbit around a world position, keeping the viewing direction. */
  focusPoint(target: THREE.Vector3, distance = 2.5): void {
    const direction = this.view.position.clone().sub(this.orbit.target)
    if (direction.lengthSq() < 1e-6) direction.set(1, 0.6, 1)
    direction.setLength(distance)
    this.orbit.target.copy(target)
    this.view.position.copy(target).add(direction)
    this.orbit.update()
  }

  set mode(mode: GizmoMode) {
    this.gizmo.setMode(mode)
  }

  /** Snap gizmo moves to a grid and turns to an angle; null for free. */
  setSnap(move: number | null, rotateDegrees: number | null): void {
    this.gizmo.setTranslationSnap(move)
    this.gizmo.setRotationSnap(rotateDegrees === null ? null : THREE.MathUtils.degToRad(rotateDegrees))
  }

  private writeBack(): void {
    if (!this.target) return
    this.target.apply(this.proxy.position, this.proxy.quaternion)
    this.onChanged?.()
  }

  dispose(): void {
    this.deactivate()
    this.orbit.dispose()
    this.gizmo.dispose()
    this.engine.scene.remove(this.proxy)
  }
}
