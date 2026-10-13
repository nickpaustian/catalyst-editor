import * as THREE from "three"
import { OrbitControls, TransformControls } from "three/examples/jsm/Addons.js"
import { Catalyst, Collider, type Node3D } from "@vitrine/catalyst"

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
    node.transform.position = position.clone()
    node.transform.rotation = rotation.clone()
    if (node instanceof Collider) node.needsUpdate()
  },
})

/**
 * Authoring camera: orbit around a point of interest, with a transform gizmo
 * on a proxy object that writes back to the selected Catalyst node. Catalyst
 * renders through whatever camera is its target, so this bypasses the Camera
 * node (which syncs node transform → view every frame) with a plain camera.
 */
export class EditorCamera {
  public readonly view: THREE.PerspectiveCamera
  private readonly orbit: OrbitControls
  private readonly gizmo: TransformControls
  private readonly proxy = new THREE.Object3D()
  private target: GizmoTarget | null = null
  private active = false
  private previousTarget: THREE.Camera | null = null
  private unsubscribe: (() => void) | null = null
  private onNodeChanged: (() => void) | null = null

  constructor() {
    const catalyst = Catalyst._
    const renderer = catalyst.renderer
    if (!renderer) throw new Error("EditorCamera needs the Catalyst renderer")

    this.view = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.05,
      500
    )
    this.view.position.set(6, 5, 8)

    this.orbit = new OrbitControls(this.view, renderer.domElement)
    this.orbit.target.set(0, 0.5, 0)
    this.orbit.enableDamping = true
    this.orbit.enabled = false

    this.gizmo = new TransformControls(this.view, renderer.domElement)
    this.gizmo.setSize(0.8)
    this.gizmo.addEventListener("dragging-changed", (event) => {
      this.orbit.enabled = this.active && !event.value
    })
    this.gizmo.addEventListener("objectChange", () => this.writeBack())

    catalyst.scene.add(this.proxy)
  }

  public get isActive(): boolean {
    return this.active
  }

  /** Where the orbit is centred; a sensible place to drop new nodes. */
  public get orbitTarget(): THREE.Vector3 {
    return this.orbit.target.clone()
  }

  /** Make this the rendering camera and start orbiting. */
  public activate(): void {
    if (this.active) return
    const catalyst = Catalyst._
    const camera = catalyst.camera
    if (!camera) return

    this.previousTarget = camera.target
    camera.target = this.view
    this.view.aspect = window.innerWidth / window.innerHeight
    this.view.updateProjectionMatrix()

    this.orbit.enabled = true
    catalyst.scene.add(this.gizmo.getHelper())
    this.unsubscribe = catalyst.signals.onRender.subscribe(() => {
      this.orbit.update()
    })
    this.active = true
  }

  /** Hand rendering back to whatever camera was active before. */
  public deactivate(): void {
    if (!this.active) return
    const catalyst = Catalyst._
    this.orbit.enabled = false
    this.detach()
    catalyst.scene.remove(this.gizmo.getHelper())
    this.unsubscribe?.()
    this.unsubscribe = null
    if (catalyst.camera && this.previousTarget) {
      catalyst.camera.target = this.previousTarget
    }
    this.active = false
  }

  /** Orbit around a node, keeping the current viewing direction. */
  public focus(node: Node3D, distance = 2.5): void {
    this.focusPoint(node.transform.getWorldPosition(), distance)
  }

  /** Put the gizmo on a node. The proxy mirrors its world transform. */
  public attach(node: Node3D, onChanged?: () => void): void {
    this.attachTarget(nodeTarget(node), onChanged)
  }

  /** Put the gizmo on anything that can report and apply a transform. */
  public attachTarget(target: GizmoTarget, onChanged?: () => void): void {
    this.target = target
    this.onNodeChanged = onChanged ?? null
    this.syncFromNode()
    this.gizmo.attach(this.proxy)
  }

  public detach(): void {
    this.gizmo.detach()
    this.target = null
    this.onNodeChanged = null
  }

  /** Refresh the proxy after the target moved by other means (panel fields, move mode). */
  public syncFromNode(): void {
    if (!this.target) return
    this.proxy.position.copy(this.target.position())
    const rotation = this.target.rotation?.()
    if (rotation) this.proxy.quaternion.copy(rotation)
    else this.proxy.quaternion.identity()
  }

  /** Orbit around a world position. */
  public focusPoint(target: THREE.Vector3, distance = 2.5): void {
    const direction = this.view.position.clone().sub(this.orbit.target)
    if (direction.lengthSq() < 1e-6) direction.set(1, 0.6, 1)
    direction.setLength(distance)
    this.orbit.target.copy(target)
    this.view.position.copy(target).add(direction)
    this.orbit.update()
  }

  public set mode(mode: GizmoMode) {
    this.gizmo.setMode(mode)
  }

  // Scene roots have identity transforms, so the proxy's world transform is
  // the node's local one
  private writeBack(): void {
    if (!this.target) return
    this.target.apply(this.proxy.position, this.proxy.quaternion)
    this.onNodeChanged?.()
  }

  public dispose(): void {
    this.deactivate()
    this.orbit.dispose()
    this.gizmo.dispose()
    Catalyst._.scene.remove(this.proxy)
  }
}
