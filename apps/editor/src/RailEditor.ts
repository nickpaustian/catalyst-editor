import * as THREE from "three"
import { Catalyst, type BezierCurve, type ControlPoint } from "@vitrine/catalyst"
import type { Exhibition } from "@vitrine/runtime"
import type { EditorCamera } from "./EditorCamera"

const MARKER_COLOUR = 0xffd54a
const SELECTED_COLOUR = 0x4ad0ff

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  Object.assign(node, props)
  children.forEach((child) => node.append(child))
  return node
}

const round = (n: number, places = 4) => Number(n.toFixed(places))

/**
 * Rail section of the panel: control point list, position and name fields,
 * add/delete, markers in the scene, and switching the guided camera between
 * the baked recording and the live rail so edits can be previewed and
 * recorded.
 */
export class RailEditor {
  public readonly root: HTMLElement
  private exhibition: Exhibition
  private camera: () => EditorCamera | null
  private list: HTMLElement
  private fields: Record<string, HTMLInputElement> = {}
  private nameField: HTMLInputElement
  private bakedButton: HTMLButtonElement
  private recordButton: HTMLButtonElement
  private selected: number = -1
  private markers: THREE.Mesh[] = []
  private markerGeometry = new THREE.SphereGeometry(0.06, 12, 8)
  private markerMaterial = new THREE.MeshBasicMaterial({ color: MARKER_COLOUR })
  private selectedMaterial = new THREE.MeshBasicMaterial({ color: SELECTED_COLOUR })
  private shown = false

  constructor(exhibition: Exhibition, camera: () => EditorCamera | null) {
    this.exhibition = exhibition
    this.camera = camera

    this.list = el("div", { className: "node-list" })
    this.nameField = el("input", { type: "text", placeholder: "name" })
    this.nameField.addEventListener("change", () => this.writeName())
    this.bakedButton = this.button("", () => this.toggleBaked())
    this.recordButton = this.button("", () => this.toggleRecording())

    this.root = el("div", {}, [
      el("h2", { textContent: "Rail" }),
      el("div", {}, [
        this.button("Show rail", () => this.toggleShown()),
        this.bakedButton,
        this.recordButton,
      ]),
      el("p", {
        className: "hint",
        textContent:
          "In guided view with the rail driving, scroll previews the live rail. Recording follows the rail to the end and downloads camera-path.json.",
      }),
      this.list,
      el("div", { className: "row" }, [this.nameField]),
      this.positionRow(),
      el("div", {}, [
        this.button("Add after", () => this.addAfter()),
        this.button("Delete point", () => this.remove()),
        this.button("Focus point", () => this.focus()),
      ]),
    ])

    this.refreshButtons()
    setInterval(() => this.refreshButtons(), 500)
  }

  private get path(): BezierCurve | null {
    return this.exhibition.managers.scene.railPath
  }

  private get points(): ControlPoint[] {
    return this.path?.getControlPoints() ?? []
  }

  // The curve adds the rail node's offset to every control point, so markers
  // and the gizmo work in that offset space and write back without it
  private get offset(): THREE.Vector3 {
    return this.path?.transform.getWorldPosition() ?? new THREE.Vector3()
  }

  private toWorld(point: THREE.Vector3): THREE.Vector3 {
    return point.clone().add(this.offset)
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const button = el("button", { textContent: label })
    button.addEventListener("click", onClick)
    return button
  }

  private positionRow(): HTMLElement {
    const row = el("div", { className: "row" }, [
      el("span", { className: "hint", textContent: "pos " }),
    ])
    ;["x", "y", "z"].forEach((axis) => {
      const input = el("input", { type: "number", step: "0.01" })
      input.addEventListener("change", () => this.writePosition())
      this.fields[axis] = input
      row.append(el("label", { textContent: axis }), input)
    })
    return row
  }

  /** Called once the scene exists. */
  public refresh(): void {
    this.list.innerHTML = ""
    this.points.forEach((cp, index) => {
      const item = el("div", { textContent: `${index}  ${cp.name ?? "(unnamed)"}` })
      item.addEventListener("click", () => this.select(index))
      if (index === this.selected) item.classList.add("selected")
      this.list.append(item)
    })
    this.syncMarkers()
    this.readFields()
  }

  private toggleShown(): void {
    this.shown = !this.shown
    this.path?.setVisualised(this.shown)
    this.syncMarkers()
  }

  private syncMarkers(): void {
    const scene = Catalyst._.scene
    const points = this.shown ? this.points : []
    while (this.markers.length > points.length) {
      const marker = this.markers.pop()!
      scene.remove(marker)
    }
    while (this.markers.length < points.length) {
      const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial)
      scene.add(marker)
      this.markers.push(marker)
    }
    points.forEach((cp, index) => {
      const marker = this.markers[index]
      marker.position.copy(this.toWorld(cp.point))
      marker.material =
        index === this.selected ? this.selectedMaterial : this.markerMaterial
    })
  }

  private select(index: number): void {
    this.selected = index
    this.refresh()
    const cp = this.points[index]
    const camera = this.camera()
    if (!cp || !camera) return
    camera.attachTarget(
      {
        position: () => this.toWorld(cp.point),
        apply: (position) => {
          this.path?.updateControlPoint(index, {
            point: position.clone().sub(this.offset),
          })
          this.syncMarkers()
          this.readFields()
        },
      },
      () => this.readFields()
    )
  }

  private readFields(): void {
    const cp = this.points[this.selected]
    if (!cp) {
      Object.values(this.fields).forEach((f) => (f.value = ""))
      this.nameField.value = ""
      return
    }
    this.fields.x.value = String(round(cp.point.x))
    this.fields.y.value = String(round(cp.point.y))
    this.fields.z.value = String(round(cp.point.z))
    this.nameField.value = cp.name ?? ""
  }

  private writePosition(): void {
    if (this.selected < 0) return
    const point = new THREE.Vector3(
      Number(this.fields.x.value),
      Number(this.fields.y.value),
      Number(this.fields.z.value)
    )
    this.path?.updateControlPoint(this.selected, { point })
    this.syncMarkers()
    this.camera()?.syncFromNode()
  }

  private writeName(): void {
    if (this.selected < 0) return
    this.path?.updateControlPoint(this.selected, { name: this.nameField.value })
    this.refresh()
  }

  private addAfter(): void {
    const path = this.path
    if (!path) return
    const points = this.points
    const index = this.selected >= 0 ? this.selected : points.length - 1
    const current = points[index]?.point ?? new THREE.Vector3()
    const next = points[index + 1]?.point
    const point = next
      ? current.clone().lerp(next, 0.5)
      : current.clone().add(new THREE.Vector3(0, 0, -1))
    path.insertControlPoint(index + 1, { point, name: `point-${points.length}` })
    this.select(index + 1)
  }

  private remove(): void {
    if (this.selected < 0 || !this.path) return
    this.path.removeControlPoint(this.selected)
    this.camera()?.detach()
    this.selected = Math.min(this.selected, this.points.length - 1)
    this.refresh()
  }

  private focus(): void {
    const cp = this.points[this.selected]
    if (cp) this.camera()?.focusPoint(this.toWorld(cp.point))
  }

  private toggleBaked(): void {
    const scene = this.exhibition.managers.scene
    scene.useBakedPath = !scene.useBakedPath
    this.refreshButtons()
  }

  private toggleRecording(): void {
    const scene = this.exhibition.managers.scene
    if (scene.isRecording) scene.stopRecording()
    else scene.startRecording()
    this.refreshButtons()
  }

  private refreshButtons(): void {
    const scene = this.exhibition.managers.scene
    this.bakedButton.textContent = scene.useBakedPath
      ? "Camera: baked path"
      : "Camera: live rail"
    this.recordButton.textContent = scene.isRecording
      ? "Stop recording"
      : "Record baked path"
  }

  /** Control points as the manifest stores them. */
  public toManifest(): { name?: string; point: [number, number, number] }[] {
    return this.points.map((cp) => ({
      name: cp.name,
      point: [round(cp.point.x), round(cp.point.y), round(cp.point.z)],
    }))
  }
}
