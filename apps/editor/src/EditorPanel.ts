import * as THREE from "three"
import {
  BoxCollider,
  Collider,
  FocalPoint,
  FocalPointTrigger,
  Node3D,
  PointOfInterest,
} from "@vitrine/catalyst"
import { assets, Modal, type Exhibition } from "@vitrine/runtime"
import type { JsonAsset } from "@vitrine/assets"
import { EditorCamera, type GizmoMode } from "./EditorCamera"
import { EditorInput } from "./EditorInput"
import { RailEditor } from "./RailEditor"

interface CatalogueEntry {
  id: string
  title: string
  manifest: string
}

type SceneKey = "colliders" | "focalPoints" | "focalPointTriggers" | "pointsOfInterest"

const SCENE_KEYS: SceneKey[] = [
  "colliders",
  "focalPoints",
  "focalPointTriggers",
  "pointsOfInterest",
]

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

const download = (name: string, text: string) => {
  const blob = new Blob([text], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = el("a", { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

const round = (n: number, places = 4) => Number(n.toFixed(places))

/**
 * First editor slice: the runtime with visualisers on, a list of the scene
 * nodes, transform fields for the selected one, and export that patches the
 * loaded scene files with the live transforms.
 */
export class EditorPanel {
  private root: HTMLElement
  private selected: Node3D | null = null
  private fields: Record<string, HTMLInputElement> = {}
  private lists: Partial<Record<SceneKey, HTMLElement>> = {}
  private selectionLabel: HTMLElement
  private visualised = false
  private lastMoveNode: Node3D | null = null
  private camera: EditorCamera | null = null
  private rail: RailEditor
  /** Nodes added in this session, with the config they were built from, for export. */
  private created = new Map<Node3D, { type: string; config: Record<string, unknown> }>()
  private contentSelect: HTMLSelectElement
  private contentRow: HTMLElement
  private input = new EditorInput({ focusSelected: () => this.focusSelected() })
  private viewLabel: HTMLElement

  private exhibition: Exhibition

  constructor(
    exhibition: Exhibition,
    catalogue: CatalogueEntry[],
    onSwitch: (id: string) => void
  ) {
    this.exhibition = exhibition
    this.root = el("div", { id: "editor-panel" })
    document.body.classList.add("editor-panel-open")

    const select = el("select")
    catalogue.forEach((entry) => {
      select.append(
        el("option", {
          value: entry.id,
          textContent: entry.title,
          selected: entry.id === exhibition.manifest.id,
        })
      )
    })
    select.addEventListener("change", () => onSwitch(select.value))

    this.root.append(
      el("h1", { textContent: "Vitrine" }),
      el("div", { className: "row" }, [select]),
      el("h2", { textContent: "View" }),
      el("div", {}, [
        this.button("Orbit", () => this.setView("orbit")),
        this.button("First person", () => this.setView("firstPerson")),
        this.button("Guided", () => this.setView("guided")),
      ]),
      (this.viewLabel = el("div", { className: "row hint", textContent: "" })),
      el("div", {}, [
        this.button("Visualisers", () => this.toggleVisualisers()),
        this.button("Move mode (o)", () => this.toggleMoveMode()),
        this.button("Translate", () => this.setGizmo("translate")),
        this.button("Rotate", () => this.setGizmo("rotate")),
      ]),
      el("p", {
        className: "hint",
        textContent:
          "Orbit: drag to orbit, right-drag to pan, wheel to zoom; F focuses the selected node; drag the gizmo to move it. First person: WASD, click to look. Move mode: look at a node and press F to pick it up, F again to drop.",
      })
    )

    SCENE_KEYS.forEach((key) => {
      const list = el("div", { className: "node-list" })
      this.lists[key] = list
      const header = el("h2", { textContent: key })
      header.append(" ", this.button("+", () => this.addNode(key)))
      this.root.append(header, list)
    })

    this.rail = new RailEditor(exhibition, () => this.camera)
    this.root.append(this.rail.root)

    this.selectionLabel = el("div", { className: "row hint", textContent: "Nothing selected" })
    this.root.append(
      el("h2", { textContent: "Selected" }),
      this.selectionLabel,
      el("div", {}, [
        this.button("Focus", () => this.focusSelected()),
        this.button("Delete", () => this.deleteSelected()),
      ]),
      (this.contentRow = el("div", { className: "row" }, [
        el("span", { className: "hint", textContent: "content " }),
        (this.contentSelect = el("select")),
      ]))
    )
    this.contentSelect.append(el("option", { value: "", textContent: "(none)" }))
    Object.keys(exhibition.manifest.content).forEach((id) =>
      this.contentSelect.append(el("option", { value: id, textContent: id }))
    )
    this.contentSelect.addEventListener("change", () => this.writeContent())
    this.root.append(this.transformFields())

    this.root.append(
      el("h2", { textContent: "Export" }),
      el("div", {}, [
        this.button("Scene files", () => this.exportSceneFiles()),
        this.button("Manifest", () => this.exportManifest()),
      ]),
      el("p", {
        className: "hint",
        textContent:
          "Scene files are the loaded JSON with live transforms written back by node name. The manifest carries the live rail control points.",
      })
    )

    document.body.append(this.root)
    const state = exhibition.managers.state
    state.pauseOnPointerUnlock = false
    state.autoPointerLock = false
    state.lockPointerFilter = (target) =>
      !(target instanceof Node && this.root.contains(target))
    void exhibition.ready.then(() => {
      this.refreshLists()
      this.toggleVisualisers()
      this.camera = new EditorCamera()
      this.setView("orbit")
      this.rail.refresh()
    })
    setInterval(() => this.pollMoveNode(), 250)
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const button = el("button", { textContent: label })
    button.addEventListener("click", onClick)
    return button
  }

  private get scene() {
    return this.exhibition.managers.scene
  }

  private toggleVisualisers(): void {
    this.visualised = !this.visualised
    this.scene.visualiseScene(this.visualised)
  }

  private setView(view: "orbit" | "firstPerson" | "guided"): void {
    const state = this.exhibition.managers.state
    const controller = this.scene.controller
    if (view === "orbit") {
      if (state.isGuidedCamera) this.scene.toggleCamera()
      controller?.disablePointerLock()
      if (controller) controller.active = false
      this.camera?.activate()
      this.input.activate()
    } else {
      this.input.deactivate()
      this.camera?.deactivate()
      if (controller) controller.active = true
      const wantGuided = view === "guided"
      if (state.isGuidedCamera !== wantGuided) this.scene.toggleCamera()
    }
    this.viewLabel.textContent = `View: ${view}`
    if (this.selected) this.attachGizmo(this.selected)
  }

  private setGizmo(mode: GizmoMode): void {
    if (this.camera) this.camera.mode = mode
  }

  private focusSelected(): void {
    if (this.selected && this.camera?.isActive) this.camera.focus(this.selected)
  }

  private attachGizmo(node: Node3D): void {
    if (!this.camera?.isActive) return
    this.camera.attach(node, () => this.readTransform())
  }

  private toggleMoveMode(): void {
    const controller = this.scene.controller
    if (!controller) return
    controller.toggleDebugMode()
    this.exhibition.managers.ui.setInteractionLabel(
      controller.debugMode ? "move" : "View"
    )
  }

  private refreshLists(): void {
    const roots = this.scene.sceneRoots
    SCENE_KEYS.forEach((key) => {
      const list = this.lists[key]!
      list.innerHTML = ""
      roots[key]?.getChildren().forEach((node) => {
        if (!(node instanceof Node3D)) return
        const item = el("div", { textContent: node.name })
        item.addEventListener("click", () => this.select(node, key))
        if (node === this.selected) item.classList.add("selected")
        list.append(item)
      })
    })
  }

  private select(node: Node3D | null, _key: SceneKey | null): void {
    this.selected = node
    this.selectionLabel.textContent = node
      ? `${node.constructor.name} ${node.name}`
      : "Nothing selected"
    this.refreshLists()
    this.readTransform()
    this.readContent()
    if (node) this.attachGizmo(node)
    else this.camera?.detach()
  }

  private readContent(): void {
    const poi = this.selected instanceof PointOfInterest ? this.selected : null
    this.contentRow.style.display = poi ? "" : "none"
    if (poi) this.contentSelect.value = poi.modalName ?? ""
  }

  private writeContent(): void {
    const poi = this.selected
    if (!(poi instanceof PointOfInterest)) return
    poi.modalName = this.contentSelect.value || null
    this.wireContent(poi)
  }

  // Same wiring the runtime does at load: interacting opens the content modal
  private wireContent(poi: PointOfInterest): void {
    poi.onInteract = () => {
      const template = poi.modalName
        ? this.exhibition.managers.content.byId[poi.modalName]
        : undefined
      if (template) void Modal._.openWithTemplate(template)
    }
  }

  private addNode(key: SceneKey): void {
    const root = this.scene.sceneRoots[key]
    if (!root) return
    const name = `${key}-${Date.now().toString(36)}`
    const at = this.camera?.isActive
      ? this.camera.orbitTarget
      : new THREE.Vector3(0, 1, 0)

    let node: Node3D
    let type: string
    let config: Record<string, unknown>
    switch (key) {
      case "colliders":
        type = "BoxCollider"
        config = { name, width: 1, height: 1, depth: 1, visualise: this.visualised }
        node = new BoxCollider(config)
        break
      case "focalPoints":
        type = "FocalPoint"
        config = { name, visualise: this.visualised }
        node = new FocalPoint(config)
        break
      case "focalPointTriggers": {
        type = "FocalPointTrigger"
        config = { name, width: 1, height: 2, depth: 1, visualise: this.visualised }
        const focalPoints = (this.scene.sceneRoots.focalPoints?.getChildrenOfType(
          FocalPoint
        ) ?? []) as FocalPoint[]
        node = new FocalPointTrigger({ ...config, focalPoints })
        break
      }
      case "pointsOfInterest":
        type = "PointOfInterest"
        config = { name, visualise: this.visualised }
        node = new PointOfInterest(config)
        this.wireContent(node as PointOfInterest)
        break
    }
    node.transform.position = at
    root.addNode(node)
    this.created.set(node, { type, config })
    this.select(node, key)
  }

  private deleteSelected(): void {
    const node = this.selected
    if (!node) return
    this.camera?.detach()
    this.created.delete(node)
    node.dispose()
    this.select(null, null)
  }

  private transformFields(): HTMLElement {
    const wrap = el("div")
    const row = (label: string, keys: string[]) => {
      const r = el("div", { className: "row" }, [el("span", { className: "hint", textContent: label + " " })])
      keys.forEach((k) => {
        const input = el("input", { type: "number", step: "0.01" })
        input.addEventListener("change", () => this.writeTransform())
        this.fields[k] = input
        r.append(el("label", { textContent: k.slice(-1) }), input)
      })
      return r
    }
    wrap.append(row("pos", ["px", "py", "pz"]), row("rot°", ["rx", "ry", "rz"]))
    return wrap
  }

  private readTransform(): void {
    const node = this.selected
    if (!node) {
      Object.values(this.fields).forEach((f) => (f.value = ""))
      return
    }
    const p = node.transform.position
    const e = new THREE.Euler().setFromQuaternion(node.transform.rotation, "YXZ")
    this.fields.px.value = String(round(p.x))
    this.fields.py.value = String(round(p.y))
    this.fields.pz.value = String(round(p.z))
    this.fields.rx.value = String(round(THREE.MathUtils.radToDeg(e.x), 2))
    this.fields.ry.value = String(round(THREE.MathUtils.radToDeg(e.y), 2))
    this.fields.rz.value = String(round(THREE.MathUtils.radToDeg(e.z), 2))
  }

  private writeTransform(): void {
    const node = this.selected
    if (!node) return
    const f = this.fields
    node.transform.position = new THREE.Vector3(
      Number(f.px.value),
      Number(f.py.value),
      Number(f.pz.value)
    )
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(Number(f.rx.value)),
      THREE.MathUtils.degToRad(Number(f.ry.value)),
      THREE.MathUtils.degToRad(Number(f.rz.value)),
      "YXZ"
    )
    node.transform.rotation = new THREE.Quaternion().setFromEuler(euler)
    if (node instanceof Collider) node.needsUpdate()
    this.camera?.syncFromNode()
  }

  /** Follow the move mode: picking a node up selects it, dropping it refreshes the fields. */
  private pollMoveNode(): void {
    const moving = this.exhibition.managers.state.moveNode
    if (moving === this.lastMoveNode) return
    this.lastMoveNode = moving as Node3D | null
    if (moving instanceof Node3D) {
      const key = SCENE_KEYS.find((k) =>
        this.scene.sceneRoots[k]?.getChildren().includes(moving)
      )
      this.select(moving, key ?? null)
    } else {
      this.readTransform()
      this.camera?.syncFromNode()
    }
  }

  private patchedSceneJson(key: SceneKey): unknown | null {
    const asset = this.exhibition.managers.exhibitionAssets.scene[key] as
      | JsonAsset<any>
      | undefined
    const root = this.scene.sceneRoots[key]
    if (!asset?.isReady || !root) return null

    const json = structuredClone(asset.json)
    const originals = new Map<string, any>(
      (json.children ?? []).map((entry: any) => [entry.config?.name ?? entry.name, entry])
    )
    // Live children in order: originals patched by name, new nodes serialised,
    // deleted ones simply absent
    json.children = root.getChildren().flatMap((child) => {
      if (!(child instanceof Node3D)) return []
      const p = child.transform.position
      const q = child.transform.rotation
      const transform = {
        position: [round(p.x), round(p.y), round(p.z)],
        rotation: [round(q.x), round(q.y), round(q.z), round(q.w)],
      }
      const original = originals.get(child.name)
      if (original) {
        original.transform = { ...original.transform, ...transform }
        if (child instanceof PointOfInterest) {
          original.config = { ...original.config, modalName: child.modalName ?? undefined }
        }
        return [original]
      }
      const made = this.created.get(child)
      if (!made) return []
      const config: Record<string, unknown> = { ...made.config, visualise: false }
      if (child instanceof PointOfInterest) config.modalName = child.modalName ?? undefined
      return [
        {
          type: made.type,
          config,
          transform,
          properties: { tags: child.tags, layers: [1], collidesWith: [] },
        },
      ]
    })
    return json
  }

  private exportSceneFiles(): void {
    const manifest = this.exhibition.manifest
    SCENE_KEYS.forEach((key) => {
      const json = this.patchedSceneJson(key)
      const url = manifest.scene[key]
      if (!json || !url) return
      const name = url.split("/").pop() ?? `${key}.json`
      download(name, JSON.stringify(json, null, 2))
    })
  }

  private exportManifest(): void {
    const raw = assets.getAs<JsonAsset<any>>(this.exhibition.manifest.url)
    if (!raw?.isReady) return
    const json = structuredClone(raw.json)
    if (json.camera?.guided?.rail) {
      json.camera.guided.rail.controlPoints = this.rail.toManifest()
    }
    download("manifest.json", JSON.stringify(json, null, 2))
  }
}
