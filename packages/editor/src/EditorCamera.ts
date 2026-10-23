import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js"
import type { Catalyst, Node3D } from "@nickpaustian/catalyst"

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
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.previousTarget) this.engine.camera.target = this.previousTarget
    this.active = false
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
