import * as THREE from "three"
import {
  BezierCurve,
  BoxCollider,
  Catalyst,
  Collider,
  FocalPoint,
  FocalPointTrigger,
  Node3D,
  PointOfInterest,
  type ControlPoint,
} from "@vitrine/catalyst"
import {
  assets,
  Modal,
  type BakedCameraPath,
  type Exhibition,
  type ExhibitionManifest,
  type Presentation,
  type SceneFiles,
} from "@vitrine/runtime"
import type { JsonAsset } from "@vitrine/assets"
import type { LightspeedRuntime } from "@lightspeed-js/core"
import { EditorCamera, type GizmoMode } from "./EditorCamera"
import { EditorInput } from "./EditorInput"
import { ExhibitionFolder } from "./ExhibitionFolder"

export type SceneKey = "colliders" | "focalPoints" | "focalPointTriggers" | "pointsOfInterest"
export const SCENE_KEYS: SceneKey[] = ["colliders", "focalPoints", "focalPointTriggers", "pointsOfInterest"]

export type ViewMode = "orbit" | "firstPerson" | "guided"

export interface CatalogueEntry {
  id: string
  title: string
  manifest: string
}

/** What the panel shows. Each key is a Lightspeed shared cell. */
export interface EditorCells {
  "editor:exhibition": { id: string; title: string; catalogue: CatalogueEntry[] }
  "editor:folder": { name: string | null; status: string; supported: boolean }
  "editor:view": { view: ViewMode; visualised: boolean; moveMode: boolean; gizmo: GizmoMode }
  "editor:groups": { key: SceneKey; nodes: { name: string; type: string; selected: boolean }[] }[]
  "editor:selection": {
    name: string
    type: string
    group: SceneKey | null
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number }
    isPoi: boolean
    contentId: string
    contentOptions: string[]
  } | null
  /** The editable presentation strings; paths are dotted keys into the manifest's presentation. */
  "editor:presentation": { path: string; label: string; value: string; multiline: boolean }[]
  "editor:content": {
    entries: { id: string; src: string; selected: boolean; edited: boolean }[]
    selectedId: string | null
    html: string
  }
  "editor:rail": {
    shown: boolean
    cameraSource: "baked" | "rail"
    recording: boolean
    points: { index: number; name: string; selected: boolean }[]
    selected: { index: number; name: string; x: number; y: number; z: number } | null
  }
}

/** What the panel asks for. Sent through the `editor:command` cell. */
export type EditorCommand =
  | { type: "switch"; id: string }
  | { type: "openFolder" }
  | { type: "reopenLast" }
  | { type: "save" }
  | { type: "saveAs" }
  | { type: "setView"; view: ViewMode }
  | { type: "toggleVisualisers" }
  | { type: "toggleMoveMode" }
  | { type: "setGizmo"; mode: GizmoMode }
  | { type: "select"; group: SceneKey; name: string }
  | { type: "add"; group: SceneKey }
  | { type: "delete" }
  | { type: "focus" }
  | { type: "setTransform"; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }
  | { type: "setContent"; id: string }
  | { type: "rename"; name: string }
  | { type: "exportScene" }
  | { type: "exportManifest" }
  | { type: "railToggleShown" }
  | { type: "railToggleCamera" }
  | { type: "railToggleRecording" }
  | { type: "railSelect"; index: number }
  | { type: "railSetPosition"; x: number; y: number; z: number }
  | { type: "railRename"; name: string }
  | { type: "railAddAfter" }
  | { type: "railDelete" }
  | { type: "railFocus" }
  | { type: "setPresentation"; path: string; value: string }
  | { type: "contentSelect"; id: string }
  | { type: "contentSetHtml"; html: string }
  | { type: "contentPreview" }
  | { type: "contentAdd"; id: string }
  | { type: "contentDelete" }

const round = (n: number, places = 4) => Number(n.toFixed(places))

const download = (name: string, text: string) => {
  const blob = new Blob([text], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const MARKER_COLOUR = 0xffd54a
const SELECTED_COLOUR = 0x4ad0ff

/**
 * The editor's logic, with no DOM of its own. It publishes what the panel
 * shows into Lightspeed cells and acts on the commands the panel sends back,
 * so the view is plain components that never touch the scene.
 */
export class EditorSession {
  private exhibition: Exhibition
  private app: LightspeedRuntime
  private catalogue: CatalogueEntry[]
  private onSwitch: (id: string) => void
  private onOpenFolder: (folder: ExhibitionFolder) => void
  private rawManifest: ExhibitionManifest | null
  private folder: ExhibitionFolder | null
  private recordedPath: BakedCameraPath | null = null

  private camera: EditorCamera | null = null
  private input = new EditorInput({ focusSelected: () => this.focusSelected() })
  private view: ViewMode = "guided"
  private visualised = false
  private gizmo: GizmoMode = "translate"
  private selected: Node3D | null = null
  private lastMoveNode: Node3D | null = null
  private created = new Map<Node3D, { type: string; config: Record<string, unknown> }>()
  /** Nodes renamed this session → the name they had in the loaded file, so export can still find the entry. */
  private originalNames = new Map<Node3D, string>()
  /** Working copy of the manifest's presentation, applied live and saved. */
  private presentation: Presentation
  /** Content HTML edited this session, by id; entries added and removed this session. */
  private contentEdits = new Map<string, string>()
  private contentAdded = new Map<string, string>()
  private contentDeleted = new Set<string>()
  private contentSelected: string | null = null
  private pollTimer: number
  private unsubscribeCommands: () => void

  // rail
  private railShown = false
  private railSelected = -1
  private markers: THREE.Mesh[] = []
  private markerGeometry = new THREE.SphereGeometry(0.06, 12, 8)
  private markerMaterial = new THREE.MeshBasicMaterial({ color: MARKER_COLOUR })
  private selectedMaterial = new THREE.MeshBasicMaterial({ color: SELECTED_COLOUR })

  constructor(options: {
    app: LightspeedRuntime
    exhibition: Exhibition
    catalogue: CatalogueEntry[]
    onSwitch: (id: string) => void
    onOpenFolder: (folder: ExhibitionFolder) => void
    rawManifest?: ExhibitionManifest
    folder?: ExhibitionFolder
  }) {
    this.app = options.app
    this.exhibition = options.exhibition
    this.catalogue = options.catalogue
    this.onSwitch = options.onSwitch
    this.onOpenFolder = options.onOpenFolder
    this.rawManifest = options.rawManifest ?? null
    this.folder = options.folder ?? null
    this.presentation = structuredClone(this.exhibition.manifest.presentation ?? {})

    document.body.classList.add("editor-panel-open")
    const state = this.exhibition.managers.state
    state.pauseOnPointerUnlock = false
    state.autoPointerLock = false
    state.lockPointerFilter = (target) =>
      !(target instanceof Node && !!document.getElementById("editor-panel")?.contains(target))

    this.exhibition.managers.scene.onRecordingComplete = (baked) => {
      this.recordedPath = baked
      this.publishFolder(`recorded ${baked.frameCount} frames, unsaved`)
      this.publishRail()
    }

    this.unsubscribeCommands = this.app
      .shared("editor:command")
      .subscribe((command) => {
        if (command) void this.handle(command as EditorCommand)
      })

    this.publishExhibition()
    this.publishFolder()
    this.publishView()
    this.publishGroups()
    this.publishSelection()
    this.publishRail()
    this.publishPresentation()
    void this.publishContent()

    void this.exhibition.ready.then(() => {
      this.camera = new EditorCamera()
      this.toggleVisualisers()
      this.setView("orbit")
      this.publishGroups()
      this.publishRail()
      if (!document.hasFocus()) this.pauseWhileUnfocused()
    })
    this.pollTimer = window.setInterval(() => this.poll(), 250)
    window.addEventListener("blur", this.pauseWhileUnfocused)
    window.addEventListener("focus", this.resumeWhenFocused)
  }

  public dispose(): void {
    window.clearInterval(this.pollTimer)
    window.removeEventListener("blur", this.pauseWhileUnfocused)
    window.removeEventListener("focus", this.resumeWhenFocused)
    this.unsubscribeCommands()
    this.input.deactivate()
    this.camera?.dispose()
    this.folder?.revoke()
    this.showRail(false)
    document.body.classList.remove("editor-panel-open")
  }

  // ---------------- publishing ----------------

  private set<K extends keyof EditorCells>(key: K, value: EditorCells[K]): void {
    this.app.shared(key).set(value)
  }

  private get scene() {
    return this.exhibition.managers.scene
  }

  private publishExhibition(): void {
    this.set("editor:exhibition", {
      id: this.exhibition.manifest.id,
      title: this.exhibition.manifest.title,
      catalogue: this.catalogue,
    })
  }

  private publishFolder(status?: string): void {
    this.set("editor:folder", {
      name: this.folder?.name ?? null,
      status:
        status ??
        (this.folder
          ? ""
          : ExhibitionFolder.isSupported
          ? "Loaded from the server; Save as… writes a copy to a folder"
          : "This browser can't open folders; use the export buttons"),
      supported: ExhibitionFolder.isSupported,
    })
  }

  private publishView(): void {
    this.set("editor:view", {
      view: this.view,
      visualised: this.visualised,
      moveMode: this.scene.controller?.debugMode ?? false,
      gizmo: this.gizmo,
    })
  }

  private publishGroups(): void {
    const roots = this.scene.sceneRoots
    this.set(
      "editor:groups",
      SCENE_KEYS.map((key) => ({
        key,
        nodes: (roots[key]?.getChildren() ?? [])
          .filter((node): node is Node3D => node instanceof Node3D)
          .map((node) => ({
            name: node.name,
            type: node.constructor.name,
            selected: node === this.selected,
          })),
      }))
    )
  }

  private publishSelection(): void {
    const node = this.selected
    if (!node) {
      this.set("editor:selection", null)
      return
    }
    const p = node.transform.position
    const e = new THREE.Euler().setFromQuaternion(node.transform.rotation, "YXZ")
    const poi = node instanceof PointOfInterest ? node : null
    this.set("editor:selection", {
      name: node.name,
      type: node.constructor.name,
      group: this.groupOf(node),
      position: { x: round(p.x), y: round(p.y), z: round(p.z) },
      rotation: {
        x: round(THREE.MathUtils.radToDeg(e.x), 2),
        y: round(THREE.MathUtils.radToDeg(e.y), 2),
        z: round(THREE.MathUtils.radToDeg(e.z), 2),
      },
      isPoi: poi !== null,
      contentId: poi?.modalName ?? "",
      contentOptions: this.contentEntries().map((entry) => entry.id),
    })
  }

  private publishRail(): void {
    const points = this.railPoints
    const cp = points[this.railSelected]
    this.set("editor:rail", {
      shown: this.railShown,
      cameraSource: this.scene.useBakedPath ? "baked" : "rail",
      recording: this.scene.isRecording,
      points: points.map((point, index) => ({
        index,
        name: point.name ?? "(unnamed)",
        selected: index === this.railSelected,
      })),
      selected: cp
        ? {
            index: this.railSelected,
            name: cp.name ?? "",
            x: round(cp.point.x),
            y: round(cp.point.y),
            z: round(cp.point.z),
          }
        : null,
    })
  }

  private static readonly PRESENTATION_FIELDS: { path: string; label: string; multiline?: boolean }[] = [
    { path: "landing.tagline", label: "Landing tagline" },
    { path: "landing.description", label: "Landing description", multiline: true },
    { path: "landing.headphonesNote", label: "Headphones note" },
    { path: "landing.scrollPrompt", label: "Scroll prompt" },
    { path: "hud.moveHint", label: "Move hint" },
    { path: "footer.title", label: "Footer title" },
    { path: "footer.copy", label: "Footer copy", multiline: true },
    { path: "footer.creditsTitle", label: "Credits title" },
    { path: "footer.credits", label: "Credits (one per line)", multiline: true },
    { path: "footer.restartLabel", label: "Restart label" },
  ]

  private readPresentation(path: string): string {
    const [section, key] = path.split(".")
    const value = (this.presentation as any)[section]?.[key]
    return Array.isArray(value) ? value.join("\n") : value ?? ""
  }

  private writePresentation(path: string, value: string): void {
    const [section, key] = path.split(".")
    const target = ((this.presentation as any)[section] ??= {})
    target[key] = path === "footer.credits" ? value.split("\n").filter((l) => l.length) : value
    this.exhibition.managers.ui.applyPresentation(this.presentation)
    this.publishPresentation()
  }

  private publishPresentation(): void {
    this.set(
      "editor:presentation",
      EditorSession.PRESENTATION_FIELDS.map((field) => ({
        path: field.path,
        label: field.label,
        value: this.readPresentation(field.path),
        multiline: field.multiline ?? false,
      }))
    )
  }

  // ---------------- content ----------------

  /** Content entries as they would be saved: manifest ones minus deleted, plus added. */
  private contentEntries(): { id: string; src: string }[] {
    const raw = this.rawManifest ?? assets.getAs<JsonAsset<ExhibitionManifest>>(this.exhibition.manifest.url)?.json
    const entries = Object.entries(raw?.content ?? {})
      .filter(([id]) => !this.contentDeleted.has(id))
      .map(([id, entry]) => ({ id, src: entry.src }))
    this.contentAdded.forEach((src, id) => entries.push({ id, src }))
    return entries
  }

  private async contentHtml(id: string): Promise<string> {
    const edited = this.contentEdits.get(id)
    if (edited !== undefined) return edited
    const asset = this.exhibition.managers.exhibitionAssets.contentById.get(id)
    if (!asset) return ""
    await asset.ensure()
    return asset.text
  }

  private async publishContent(): Promise<void> {
    const entries = this.contentEntries()
    const selectedId = this.contentSelected && entries.some((e) => e.id === this.contentSelected)
      ? this.contentSelected
      : null
    this.set("editor:content", {
      entries: entries.map((entry) => ({
        ...entry,
        selected: entry.id === selectedId,
        edited: this.contentEdits.has(entry.id) || this.contentAdded.has(entry.id),
      })),
      selectedId,
      html: selectedId ? await this.contentHtml(selectedId) : "",
    })
  }

  private contentAdd(id: string): void {
    const clean = id.trim().replace(/[^a-zA-Z0-9_-]/g, "")
    if (!clean || this.contentEntries().some((e) => e.id === clean)) return
    const src = `content/${clean}.html`
    this.contentAdded.set(clean, src)
    this.contentEdits.set(
      clean,
      `<div class="modal-header">\n  <div class="menu-left">\n    <div id="btn-resume" class="menu-close key">\n      <div class="key-button">Close</div>\n    </div>\n  </div>\n</div>\n<div class="modal-quote-wrapper">\n  <div class="modal-article-inner">\n    <article class="scrollable">\n      <div class="content-wrapper">\n        <h1>${clean}</h1>\n      </div>\n    </article>\n  </div>\n</div>\n`
    )
    this.contentSelected = clean
    void this.publishContent()
    this.publishSelection()
  }

  private contentDelete(): void {
    const id = this.contentSelected
    if (!id) return
    if (this.contentAdded.has(id)) this.contentAdded.delete(id)
    else this.contentDeleted.add(id)
    this.contentEdits.delete(id)
    this.contentSelected = null
    void this.publishContent()
    this.publishSelection()
  }

  private async contentPreview(): Promise<void> {
    if (!this.contentSelected) return
    const html = await this.contentHtml(this.contentSelected)
    Modal._.open(html)
  }

  // ---------------- commands ----------------

  private async handle(command: EditorCommand): Promise<void> {
    switch (command.type) {
      case "switch":
        this.onSwitch(command.id)
        break
      case "openFolder": {
        const folder = await ExhibitionFolder.pick()
        if (!folder) return
        await folder.remember()
        this.onOpenFolder(folder)
        break
      }
      case "reopenLast": {
        const folder = await ExhibitionFolder.last()
        if (!folder) {
          this.publishFolder("no folder remembered")
          return
        }
        this.onOpenFolder(folder)
        break
      }
      case "save":
        if (this.folder) await this.writeTo(this.folder)
        else await this.saveAs()
        break
      case "saveAs":
        await this.saveAs()
        break
      case "setView":
        this.setView(command.view)
        break
      case "toggleVisualisers":
        this.toggleVisualisers()
        break
      case "toggleMoveMode":
        this.toggleMoveMode()
        break
      case "setGizmo":
        this.gizmo = command.mode
        if (this.camera) this.camera.mode = command.mode
        this.publishView()
        break
      case "select": {
        const node = this.scene.sceneRoots[command.group]?.getNode<Node3D>(command.name)
        this.select(node ?? null)
        break
      }
      case "add":
        this.addNode(command.group)
        break
      case "delete":
        this.deleteSelected()
        break
      case "focus":
        this.focusSelected()
        break
      case "setTransform":
        this.writeTransform(command.position, command.rotation)
        break
      case "setContent":
        this.writeContent(command.id)
        break
      case "rename":
        this.renameSelected(command.name)
        break
      case "exportScene":
        this.exportSceneFiles()
        break
      case "exportManifest": {
        const json = this.patchedManifest()
        if (json) download("manifest.json", JSON.stringify(json, null, 2))
        break
      }
      case "railToggleShown":
        this.showRail(!this.railShown)
        break
      case "railToggleCamera":
        this.scene.useBakedPath = !this.scene.useBakedPath
        this.publishRail()
        break
      case "railToggleRecording":
        if (this.scene.isRecording) this.scene.stopRecording()
        else this.scene.startRecording()
        this.publishRail()
        break
      case "railSelect":
        this.railSelect(command.index)
        break
      case "railSetPosition":
        this.railSetPosition(new THREE.Vector3(command.x, command.y, command.z))
        break
      case "railRename":
        this.path?.updateControlPoint(this.railSelected, { name: command.name })
        this.publishRail()
        break
      case "railAddAfter":
        this.railAddAfter()
        break
      case "railDelete":
        this.railDelete()
        break
      case "setPresentation":
        this.writePresentation(command.path, command.value)
        break
      case "contentSelect":
        this.contentSelected = command.id
        await this.publishContent()
        break
      case "contentSetHtml":
        if (this.contentSelected) {
          this.contentEdits.set(this.contentSelected, command.html)
          await this.publishContent()
        }
        break
      case "contentPreview":
        await this.contentPreview()
        break
      case "contentAdd":
        this.contentAdd(command.id)
        break
      case "contentDelete":
        this.contentDelete()
        break
      case "railFocus": {
        const cp = this.railPoints[this.railSelected]
        if (cp) this.camera?.focusPoint(this.toWorld(cp.point))
        break
      }
    }
  }

  // ---------------- view ----------------

  private setView(view: ViewMode): void {
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
    this.view = view
    if (this.selected) this.attachGizmo(this.selected)
    this.publishView()
  }

  private toggleVisualisers(): void {
    this.visualised = !this.visualised
    this.scene.visualiseScene(this.visualised)
    this.publishView()
  }

  private toggleMoveMode(): void {
    const controller = this.scene.controller
    if (!controller) return
    controller.toggleDebugMode()
    this.exhibition.managers.ui.setInteractionLabel(controller.debugMode ? "move" : "View")
    this.publishView()
  }

  // ---------------- nodes ----------------

  private groupOf(node: Node3D): SceneKey | null {
    return SCENE_KEYS.find((k) => this.scene.sceneRoots[k]?.getChildren().includes(node)) ?? null
  }

  private select(node: Node3D | null): void {
    this.selected = node
    if (node) {
      this.railSelected = -1
      this.attachGizmo(node)
    } else {
      this.camera?.detach()
    }
    this.publishGroups()
    this.publishSelection()
    this.publishRail()
  }

  private attachGizmo(node: Node3D): void {
    if (!this.camera?.isActive) return
    this.camera.attach(node, () => this.publishSelection())
  }

  private focusSelected(): void {
    if (this.selected && this.camera?.isActive) this.camera.focus(this.selected)
  }

  private writeTransform(
    position: { x: number; y: number; z: number },
    rotation: { x: number; y: number; z: number }
  ): void {
    const node = this.selected
    if (!node) return
    node.transform.position = new THREE.Vector3(position.x, position.y, position.z)
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(rotation.x),
      THREE.MathUtils.degToRad(rotation.y),
      THREE.MathUtils.degToRad(rotation.z),
      "YXZ"
    )
    node.transform.rotation = new THREE.Quaternion().setFromEuler(euler)
    if (node instanceof Collider) node.needsUpdate()
    this.camera?.syncFromNode()
    this.publishSelection()
  }

  private renameSelected(name: string): void {
    const node = this.selected
    const clean = name.trim()
    if (!node || !clean || clean === node.name) return
    const original = this.originalNames.get(node) ?? node.name
    if (!node.rename(clean)) {
      this.publishSelection()
      return
    }
    if (!this.created.has(node)) this.originalNames.set(node, original)
    const made = this.created.get(node)
    if (made) made.config.name = clean
    this.publishGroups()
    this.publishSelection()
  }

  private writeContent(id: string): void {
    const poi = this.selected
    if (!(poi instanceof PointOfInterest)) return
    poi.modalName = id || null
    this.wireContent(poi)
    this.publishSelection()
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
    const at = this.camera?.isActive ? this.camera.orbitTarget : new THREE.Vector3(0, 1, 0)

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
        const focalPoints = (this.scene.sceneRoots.focalPoints?.getChildrenOfType(FocalPoint) ??
          []) as FocalPoint[]
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
    this.select(node)
  }

  private deleteSelected(): void {
    const node = this.selected
    if (!node) return
    this.camera?.detach()
    this.created.delete(node)
    node.dispose()
    this.select(null)
  }

  /** Follow the move mode: picking a node up selects it, dropping it refreshes the fields. */
  // Nothing else pauses the editor (pointer unlock doesn't), so the engine
  // would keep rendering the splats whenever the window is merely behind
  // another one. A modal pauses on its own and resumes when it closes.
  private pauseWhileUnfocused = (): void => {
    Catalyst._.pause()
  }

  private resumeWhenFocused = (): void => {
    if (!Modal._.isOpen) Catalyst._.resume()
  }

  private poll(): void {
    const moving = this.exhibition.managers.state.moveNode
    if (moving === this.lastMoveNode) {
      if (this.scene.isRecording !== (this.app.shared("editor:rail").value as any)?.recording) {
        this.publishRail()
      }
      return
    }
    this.lastMoveNode = moving as Node3D | null
    if (moving instanceof Node3D) {
      this.select(moving)
    } else {
      this.publishSelection()
      this.camera?.syncFromNode()
    }
  }

  // ---------------- rail ----------------

  private get path(): BezierCurve | null {
    return this.scene.railPath
  }

  private get railPoints(): ControlPoint[] {
    return this.path?.getControlPoints() ?? []
  }

  // The curve adds the rail node's offset to every control point, so markers
  // and the gizmo work in that offset space and write back without it
  private get railOffset(): THREE.Vector3 {
    return this.path?.transform.getWorldPosition() ?? new THREE.Vector3()
  }

  private toWorld(point: THREE.Vector3): THREE.Vector3 {
    return point.clone().add(this.railOffset)
  }

  private showRail(shown: boolean): void {
    this.railShown = shown
    this.path?.setVisualised(shown)
    this.syncMarkers()
    this.publishRail()
  }

  private syncMarkers(): void {
    const scene = Catalyst._.scene
    const points = this.railShown ? this.railPoints : []
    while (this.markers.length > points.length) scene.remove(this.markers.pop()!)
    while (this.markers.length < points.length) {
      const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial)
      scene.add(marker)
      this.markers.push(marker)
    }
    points.forEach((cp, index) => {
      const marker = this.markers[index]
      marker.position.copy(this.toWorld(cp.point))
      marker.material = index === this.railSelected ? this.selectedMaterial : this.markerMaterial
    })
  }

  private railSelect(index: number): void {
    this.railSelected = index
    this.selected = null
    const cp = this.railPoints[index]
    if (cp && this.camera?.isActive) {
      this.camera.attachTarget(
        {
          position: () => this.toWorld(cp.point),
          apply: (position) => {
            this.path?.updateControlPoint(index, { point: position.clone().sub(this.railOffset) })
            this.syncMarkers()
            this.publishRail()
          },
        },
        () => this.publishRail()
      )
    }
    this.syncMarkers()
    this.publishGroups()
    this.publishSelection()
    this.publishRail()
  }

  private railSetPosition(point: THREE.Vector3): void {
    if (this.railSelected < 0) return
    this.path?.updateControlPoint(this.railSelected, { point })
    this.syncMarkers()
    this.camera?.syncFromNode()
    this.publishRail()
  }

  private railAddAfter(): void {
    const path = this.path
    if (!path) return
    const points = this.railPoints
    const index = this.railSelected >= 0 ? this.railSelected : points.length - 1
    const current = points[index]?.point ?? new THREE.Vector3()
    const next = points[index + 1]?.point
    const point = next
      ? current.clone().lerp(next, 0.5)
      : current.clone().add(new THREE.Vector3(0, 0, -1))
    path.insertControlPoint(index + 1, { point, name: `point-${points.length}` })
    this.railSelect(index + 1)
  }

  private railDelete(): void {
    if (this.railSelected < 0 || !this.path) return
    this.path.removeControlPoint(this.railSelected)
    this.camera?.detach()
    this.railSelected = Math.min(this.railSelected, this.railPoints.length - 1)
    this.syncMarkers()
    this.publishRail()
  }

  private railToManifest(): { name: string; point: [number, number, number] }[] {
    return this.railPoints.map((cp, index) => ({
      name: cp.name ?? `point-${index}`,
      point: [round(cp.point.x), round(cp.point.y), round(cp.point.z)],
    }))
  }

  // ---------------- export and save ----------------

  private patchedManifest(): ExhibitionManifest | null {
    const raw =
      this.rawManifest ??
      assets.getAs<JsonAsset<ExhibitionManifest>>(this.exhibition.manifest.url)?.json
    if (!raw) return null
    const json = structuredClone(raw)
    if (json.camera.guided?.rail) {
      json.camera.guided.rail.controlPoints = this.railToManifest()
    }
    json.presentation = { ...json.presentation, ...structuredClone(this.presentation) }
    this.contentDeleted.forEach((id) => delete json.content[id])
    this.contentAdded.forEach((src, id) => {
      json.content[id] = { type: "html", src }
    })
    return json
  }

  private patchedSceneJson(key: SceneKey): unknown | null {
    const asset = this.exhibition.managers.exhibitionAssets.scene[key] as JsonAsset<any> | undefined
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
      const original = originals.get(this.originalNames.get(child) ?? child.name)
      if (original) {
        original.transform = { ...original.transform, ...transform }
        if (this.originalNames.has(child)) {
          original.config = { ...original.config, name: child.name }
        }
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
      download(url.split("/").pop() ?? `${key}.json`, JSON.stringify(json, null, 2))
    })
  }

  private async collectFiles(): Promise<{ manifest: ExhibitionManifest; text: Record<string, string> }> {
    const manifest = this.patchedManifest()
    if (!manifest) throw new Error("No manifest to save")
    const text: Record<string, string> = {}

    SCENE_KEYS.forEach((key) => {
      const path = manifest.scene[key as keyof SceneFiles]
      const json = this.patchedSceneJson(key)
      if (path && json) text[path] = JSON.stringify(json, null, 2) + "\n"
    })

    const bakedPath = manifest.camera.guided?.bakedPath
    if (bakedPath) {
      if (this.recordedPath) {
        text[bakedPath] = JSON.stringify(this.recordedPath)
      } else {
        const asset = this.exhibition.managers.exhibitionAssets.bakedPath
        if (asset) {
          await asset.ensure()
          text[bakedPath] = JSON.stringify(asset.json)
        }
      }
    }

    const content = this.exhibition.managers.exhibitionAssets
    for (const [id, entry] of Object.entries(manifest.content)) {
      const edited = this.contentEdits.get(id)
      if (edited !== undefined) {
        text[entry.src] = edited
        continue
      }
      const asset = content.contentById.get(id)
      if (!asset) continue
      await asset.ensure()
      text[entry.src] = asset.text
    }
    const menuPath = manifest.presentation?.menu
    if (menuPath) {
      await content.menu.ensure()
      text[menuPath] = content.menu.text
    }

    return { manifest, text }
  }

  private async saveAs(): Promise<void> {
    const folder = await ExhibitionFolder.pick()
    if (!folder) return
    await this.writeTo(folder)
    this.folder = folder
    await folder.remember()
    this.publishFolder(`saved ${new Date().toLocaleTimeString()}`)
  }

  public async writeTo(folder: ExhibitionFolder): Promise<void> {
    this.publishFolder("saving…")
    try {
      const files = await this.collectFiles()
      const written = await folder.writeAll(files)
      this.recordedPath = null
      this.publishFolder(`saved ${written.length} files ${new Date().toLocaleTimeString()}`)
    } catch (error) {
      this.publishFolder(`save failed: ${(error as Error).message}`)
      throw error
    }
  }
}
