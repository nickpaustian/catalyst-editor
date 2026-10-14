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
  editorIcon,
  exposedProperties,
  type ControlPoint,
  type ExposedProperty,
  type ResolutionSettings,
} from "@vitrine/catalyst"
import {
  assets,
  Modal,
  type BakedCameraPath,
  type Exhibition,
  type ExhibitionManifest,
  type Presentation,
} from "@vitrine/runtime"
import type { JsonAsset } from "@vitrine/assets"
import type { LightspeedRuntime } from "@lightspeed-js/core"
import { EditorCamera, groupTarget, type GizmoMode } from "./EditorCamera"
import { EditorInput } from "./EditorInput"
import { ExhibitionFolder } from "./ExhibitionFolder"

/** What the editor can add to the hierarchy; Group is an empty Node3D. */
export type NodeKind = "Group" | "BoxCollider" | "FocalPoint" | "FocalPointTrigger" | "PointOfInterest"

export interface TreeRow {
  id: number
  name: string
  type: string
  icon: string
  depth: number
  hasChildren: boolean
  expanded: boolean
  selected: boolean
  /** The one the fields panel and gizmo pivot follow; the last clicked. */
  active: boolean
  isRoot: boolean
}

export type DropPlace = "before" | "after" | "inside"

const ADDABLE: { kind: NodeKind; label: string; cls: object }[] = [
  { kind: "Group", label: "Group", cls: Node3D },
  { kind: "BoxCollider", label: "Collider", cls: BoxCollider },
  { kind: "FocalPoint", label: "Focal point", cls: FocalPoint },
  { kind: "FocalPointTrigger", label: "Trigger", cls: FocalPointTrigger },
  { kind: "PointOfInterest", label: "Point of interest", cls: PointOfInterest },
]

/** replace: plain click, toggle: ctrl/cmd click, range: shift click from the anchor. */
export type SelectMode = "replace" | "toggle" | "range"

/** An exposed property of the selected node with its current value. */
export interface SelectionProperty extends ExposedProperty {
  label: string
  value: number | boolean | string
}

/** Where a hierarchy saved from a legacy four-file exhibition goes. */
const SCENE_FILE = "scene/scene.json"

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
  /** The scene hierarchy flattened in tree order, collapsed subtrees left out. */
  "editor:tree": TreeRow[]
  /** What the tree can add: a kind for the `add` command with its label and icon. */
  "editor:kinds": { kind: NodeKind; label: string; icon: string }[]
  "editor:selection": {
    id: number
    name: string
    type: string
    icon: string
    /** How many nodes are selected; the rest of this cell describes the active one. */
    count: number
    parent: string | null
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number }
    isPoi: boolean
    contentId: string
    contentOptions: string[]
    properties: SelectionProperty[]
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
  | { type: "select"; id: number; mode?: SelectMode }
  | { type: "add"; kind: NodeKind }
  | { type: "toggleExpand"; id: number }
  | { type: "move"; ids: number[]; targetId: number; place: DropPlace }
  | { type: "delete" }
  | { type: "focus" }
  | { type: "setTransform"; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }
  | { type: "setContent"; id: string }
  | { type: "setProperty"; key: string; value: unknown }
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

// Authoring doesn't need Retina splats while the camera is moving: drop to 1x
// as soon as it moves and go back to full resolution once it has settled
const EDITOR_RESOLUTION: ResolutionSettings = {
  mode: "adaptive",
  movingPixelRatio: 1,
  stillPixelRatio: 2,
  settleMs: 300,
}

// With on-demand rendering the scene only redraws when the camera moves or
// something asks; any interaction asks, since the gizmo and visualisers react
// to pointer and keyboard input without the camera moving
const INTERACTION_EVENTS = ["pointermove", "pointerdown", "pointerup", "wheel", "keydown", "keyup"] as const

const isOverViewport = (target: EventTarget | null): boolean =>
  target instanceof Node && !!document.querySelector(".pane-body.viewport")?.contains(target)

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
  /** The active node: last clicked, what the fields and gizmo pivot follow. */
  private selected: Node3D | null = null
  private selection = new Set<Node3D>()
  /** Where a shift-click range starts: the last node picked without shift. */
  private anchor: Node3D | null = null
  private lastMoveNode: Node3D | null = null
  private created = new Map<Node3D, { type: string; config: Record<string, unknown> }>()
  /** Each loaded node → its entry in the scene file, so a save keeps fields the editor doesn't know. */
  private originals = new Map<Node3D, any>()
  private ids = new Map<Node3D, number>()
  private nodesById = new Map<number, Node3D>()
  private nextId = 1
  private collapsed = new Set<Node3D>()
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
    state.lockPointerFilter = isOverViewport
    Catalyst._.input!.scrollFilter = (event) => isOverViewport(event.target)

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
    this.publishKinds()
    this.publishFolder()
    this.publishView()
    this.publishTree()
    this.publishSelection()
    this.publishRail()
    this.publishPresentation()
    void this.publishContent()

    void this.exhibition.ready.then(() => {
      this.camera = new EditorCamera()
      Catalyst._.resolution = EDITOR_RESOLUTION
      Catalyst._.renderOnDemand = true
      this.toggleVisualisers()
      this.setView("orbit")
      void this.captureOriginals().then(() => this.publishTree())
      this.publishRail()
      if (!document.hasFocus()) this.pauseWhileUnfocused()
    })
    this.pollTimer = window.setInterval(() => this.poll(), 250)
    window.addEventListener("blur", this.pauseWhileUnfocused)
    window.addEventListener("focus", this.resumeWhenFocused)
    for (const type of INTERACTION_EVENTS) {
      document.addEventListener(type, this.requestRender, { capture: true, passive: true })
    }
  }

  public dispose(): void {
    window.clearInterval(this.pollTimer)
    window.removeEventListener("blur", this.pauseWhileUnfocused)
    window.removeEventListener("focus", this.resumeWhenFocused)
    for (const type of INTERACTION_EVENTS) {
      document.removeEventListener(type, this.requestRender, { capture: true })
    }
    Catalyst._.renderOnDemand = false
    Catalyst._.input!.scrollFilter = null
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

  private publishKinds(): void {
    this.set(
      "editor:kinds",
      ADDABLE.map(({ kind, label, cls }) => ({ kind, label, icon: editorIcon(cls) }))
    )
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
      status: status ?? "",
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

  private get root(): Node3D | null {
    return this.scene.sceneRoot
  }

  private idOf(node: Node3D): number {
    let id = this.ids.get(node)
    if (id === undefined) {
      id = this.nextId++
      this.ids.set(node, id)
      this.nodesById.set(id, node)
    }
    return id
  }

  private childNodes(node: Node3D): Node3D[] {
    return node.getChildren().filter((child): child is Node3D => child instanceof Node3D)
  }

  // Prefabs add their own child nodes (a point of interest's collider and
  // raycast, a trigger's collider); those are internals, not scene content.
  // The authored scene is what came from the file plus what the editor made.
  private ownedChildren(node: Node3D): Node3D[] {
    return this.childNodes(node).filter((child) => this.originals.has(child) || this.created.has(child))
  }

  /** The nodes the tree shows, in row order. */
  private visibleNodes(): { node: Node3D; depth: number }[] {
    const rows: { node: Node3D; depth: number }[] = []
    const visit = (node: Node3D, depth: number) => {
      rows.push({ node, depth })
      if (!this.collapsed.has(node)) this.ownedChildren(node).forEach((child) => visit(child, depth + 1))
    }
    if (this.root) visit(this.root, 0)
    return rows
  }

  private publishTree(): void {
    const rows: TreeRow[] = this.visibleNodes().map(({ node, depth }) => ({
      id: this.idOf(node),
      name: node.name,
      type: node.constructor.name,
      icon: editorIcon(node),
      depth,
      hasChildren: this.ownedChildren(node).length > 0,
      expanded: !this.collapsed.has(node),
      selected: this.selection.has(node),
      active: node === this.selected,
      isRoot: node === this.root,
    }))
    this.set("editor:tree", rows)
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
      id: this.idOf(node),
      name: node.name,
      type: node.constructor.name,
      icon: editorIcon(node),
      count: this.selection.size,
      parent: node.parent instanceof Node3D ? node.parent.name : null,
      position: { x: round(p.x), y: round(p.y), z: round(p.z) },
      rotation: {
        x: round(THREE.MathUtils.radToDeg(e.x), 2),
        y: round(THREE.MathUtils.radToDeg(e.y), 2),
        z: round(THREE.MathUtils.radToDeg(e.z), 2),
      },
      isPoi: poi !== null,
      contentId: poi?.modalName ?? "",
      contentOptions: this.contentEntries().map((entry) => entry.id),
      properties: this.selectionProperties(node),
    })
  }

  private selectionProperties(node: Node3D): SelectionProperty[] {
    return exposedProperties(node).map((property) => {
      const raw = (node as any)[property.key]
      const value = property.type === "number" ? round(Number(raw)) : raw
      return { ...property, label: property.label ?? property.key, value }
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
      case "select":
        this.select(this.nodesById.get(command.id) ?? null, command.mode)
        break
      case "add":
        this.addNode(command.kind)
        break
      case "toggleExpand": {
        const node = this.nodesById.get(command.id)
        if (node) {
          if (this.collapsed.has(node)) this.collapsed.delete(node)
          else this.collapsed.add(node)
          this.publishTree()
        }
        break
      }
      case "move":
        this.moveNodes(command.ids, command.targetId, command.place)
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
      case "setProperty":
        this.writeProperty(command.key, command.value)
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
    this.requestRender()
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

  private select(node: Node3D | null, mode: SelectMode = "replace"): void {
    const root = this.root
    if (node === root && mode !== "replace") return
    if (!node) {
      this.selection.clear()
      this.anchor = null
    } else if (mode === "toggle") {
      if (this.selection.has(node)) {
        this.selection.delete(node)
        node = Array.from(this.selection).pop() ?? null
      } else {
        this.selection.delete(root!)
        this.selection.add(node)
      }
      this.anchor = node
    } else if (mode === "range" && this.anchor) {
      const visible = this.visibleNodes().map((row) => row.node)
      const from = visible.indexOf(this.anchor)
      const to = visible.indexOf(node)
      if (from >= 0 && to >= 0) {
        const span = visible.slice(Math.min(from, to), Math.max(from, to) + 1)
        this.selection = new Set(span.filter((n) => n !== root))
      } else {
        this.selection = new Set([node])
        this.anchor = node
      }
    } else {
      this.selection = new Set([node])
      this.anchor = node
    }
    this.activate(node)
  }

  private activate(node: Node3D | null): void {
    this.selected = node
    if (node) {
      this.railSelected = -1
      if (node === this.root) this.camera?.detach()
      else this.attachGizmo(node)
    } else {
      this.camera?.detach()
    }
    this.publishTree()
    this.publishSelection()
    this.publishRail()
  }

  /** Selected nodes with no selected ancestor: moving or deleting these covers the whole selection. */
  private selectionRoots(): Node3D[] {
    return Array.from(this.selection).filter(
      (node) => node !== this.root && !Array.from(this.selection).some((other) => other !== node && other.contains(node))
    )
  }

  private attachGizmo(node: Node3D): void {
    if (!this.camera?.isActive) return
    const publish = () => this.publishSelection()
    if (this.selection.size > 1) this.camera.attachTarget(groupTarget(this.selectionRoots(), node), publish)
    else this.camera.attach(node, publish)
  }

  private focusSelected(): void {
    if (!this.selected || !this.camera?.isActive) return
    if (this.selection.size <= 1) {
      this.camera.focus(this.selected)
      return
    }
    const centre = new THREE.Vector3()
    this.selection.forEach((node) => centre.add(node.transform.getWorldPosition()))
    this.camera.focusPoint(centre.divideScalar(this.selection.size))
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
    // Activation rules and content find nodes by name, so names stay unique
    // across the whole scene, not just among siblings
    if (this.root?.find(clean) || !node.rename(clean)) {
      this.publishSelection()
      return
    }
    const made = this.created.get(node)
    if (made) made.config.name = clean
    this.publishTree()
    this.publishSelection()
  }

  private writeProperty(key: string, value: unknown): void {
    const node = this.selected
    if (!node) return
    const property = exposedProperties(node).find((p) => p.key === key)
    if (!property) return
    let next: unknown = value
    if (property.type === "number") {
      next = Number(value)
      if (!Number.isFinite(next)) return
      if (property.min !== undefined) next = Math.max(property.min, next as number)
      if (property.max !== undefined) next = Math.min(property.max, next as number)
    } else if (property.type === "boolean") {
      next = Boolean(value)
    } else {
      next = String(value)
    }
    ;(node as any)[key] = next
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

  /** New nodes go under the selected node (or the root), at the orbit target in world space. */
  private addNode(kind: NodeKind): void {
    const parent = this.selected ?? this.root
    if (!parent) return
    const name = `${kind.toLowerCase()}-${Date.now().toString(36)}`
    const at = this.camera?.isActive ? this.camera.orbitTarget : new THREE.Vector3(0, 1, 0)

    let node: Node3D
    let type: string = kind
    let config: Record<string, unknown>
    switch (kind) {
      case "Group":
        type = "Node3D"
        config = { name, visualise: this.visualised }
        node = new Node3D(config)
        break
      case "BoxCollider":
        config = { name, width: 1, height: 1, depth: 1, visualise: this.visualised }
        node = new BoxCollider(config)
        break
      case "FocalPoint":
        config = { name, visualise: this.visualised }
        node = new FocalPoint(config)
        break
      case "FocalPointTrigger":
        config = { name, width: 1, height: 2, depth: 1, visualise: this.visualised }
        node = new FocalPointTrigger({ ...config, focalPoints: this.scene.focalPointNodes })
        break
      case "PointOfInterest":
        config = { name, visualise: this.visualised }
        node = new PointOfInterest(config)
        this.wireContent(node as PointOfInterest)
        break
    }
    parent.addNode(node)
    node.transform.setWorldMatrix(new THREE.Matrix4().makeTranslation(at.x, at.y, at.z))
    this.created.set(node, { type, config })
    this.collapsed.delete(parent)
    if (node instanceof FocalPoint) this.scene.refreshFocalPointTargets()
    this.select(node)
  }

  private deleteSelected(): void {
    const nodes = this.selectionRoots()
    if (nodes.length === 0) return
    this.camera?.detach()
    let hadFocalPoints = false
    nodes.forEach((node) => {
      node.walk().forEach((n) => {
        if (n instanceof FocalPoint) hadFocalPoints = true
        if (n instanceof Node3D) {
          this.created.delete(n)
          this.originals.delete(n)
          const id = this.ids.get(n)
          if (id !== undefined) this.nodesById.delete(id)
          this.ids.delete(n)
        }
      })
      node.dispose()
    })
    if (hadFocalPoints) this.scene.refreshFocalPointTargets()
    this.select(null)
  }

  /** Reparent or reorder nodes, keeping their world transforms and tree order. */
  private moveNodes(ids: number[], targetId: number, place: DropPlace): void {
    const target = this.nodesById.get(targetId)
    const root = this.root
    if (!target || !root) return
    const order = this.visibleNodes().map((row) => row.node)
    const nodes = ids
      .map((id) => this.nodesById.get(id))
      .filter((node): node is Node3D => node !== undefined && node !== root && node !== target)
      .filter((node, _, all) => !all.some((other) => other !== node && other.contains(node)))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    if (nodes.length === 0 || nodes.some((node) => node.contains(target))) return
    const newParent = place === "inside" ? target : target.parent
    if (!(newParent instanceof Node3D)) return
    for (const node of nodes) {
      if (node.parent !== newParent && newParent.children.has(node.name)) {
        this.publishFolder(`"${node.name}" already exists under ${newParent.name}`)
        return
      }
    }

    const worlds = new Map(nodes.map((node) => [node, node.transform.getWorldMatrix().clone()]))
    nodes.forEach((node) => (node.parent as Node3D).detach(node))
    let index =
      place === "inside" ? newParent.children.size : newParent.indexOf(target) + (place === "after" ? 1 : 0)
    nodes.forEach((node) => {
      newParent.insertNode(node, index++, node.name)
      node.transform.setWorldMatrix(worlds.get(node)!)
      node.walk().forEach((n) => {
        if (n instanceof Collider) n.needsUpdate()
      })
    })
    this.collapsed.delete(newParent)
    this.camera?.syncFromNode()
    this.publishTree()
    this.publishSelection()
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

  private requestRender = (): void => {
    Catalyst._.requestRender()
  }

  private poll(): void {
    const moving = this.exhibition.managers.state.moveNode
    if (moving) this.requestRender()
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
    this.selection.clear()
    this.anchor = null
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
    this.publishTree()
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
    // Saving always writes the hierarchy as one file; a legacy manifest
    // moves to it here and its four files are simply no longer written
    if (typeof json.scene !== "string") json.scene = SCENE_FILE
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

  /**
   * Pair every loaded node with its entry in the scene file(s), in tree order,
   * so a save carries fields the editor doesn't edit. Legacy exhibitions pair
   * each file's root with the group it became.
   */
  private async captureOriginals(): Promise<void> {
    const root = this.root
    if (!root) return
    const scene = this.exhibition.managers.exhibitionAssets.scene
    // parseJsonNodes appends a file's children after the ones a prefab's
    // constructor made, so the entries line up with the last N children
    const pair = (entry: any, node: Node3D) => {
      this.originals.set(node, entry)
      const children = this.childNodes(node)
      const entries: any[] = entry?.children ?? []
      const offset = children.length - entries.length
      entries.forEach((childEntry, index) => {
        const child = children[offset + index]
        if (child) pair(childEntry, child)
      })
    }
    if (scene.tree) {
      await scene.tree.ensure()
      pair(scene.tree.json, root)
      return
    }
    const files = [scene.colliders, scene.focalPoints, scene.focalPointTriggers, scene.pointsOfInterest]
    const groups = this.childNodes(root)
    for (let index = 0; index < files.length; index++) {
      const asset = files[index] as JsonAsset<any> | undefined
      const group = groups[index]
      if (!asset || !group) continue
      await asset.ensure()
      pair(asset.json, group)
    }
  }

  private serialiseNode(node: Node3D): any {
    const p = node.transform.position
    const q = node.transform.rotation
    const transform = {
      position: [round(p.x), round(p.y), round(p.z)],
      rotation: [round(q.x), round(q.y), round(q.z), round(q.w)],
    }
    const children = this.ownedChildren(node).map((child) => this.serialiseNode(child))
    const original = this.originals.get(node)

    let entry: any
    if (original) {
      const { children: _children, name: _name, ...rest } = original
      entry = {
        ...rest,
        config: { ...(original.config ?? {}), name: node.name },
        transform: { ...(original.transform ?? {}), ...transform },
      }
    } else {
      const made = this.created.get(node)
      const type = made?.type ?? node.constructor.name
      entry = { type, config: { ...(made?.config ?? {}), name: node.name, visualise: false }, transform }
      if (type !== "Node3D") entry.properties = { tags: node.tags, layers: [1], collidesWith: [] }
    }
    if (node instanceof PointOfInterest) entry.config.modalName = node.modalName ?? undefined
    for (const property of exposedProperties(node)) {
      const raw = (node as any)[property.key]
      const value = property.type === "number" ? round(Number(raw)) : raw
      if (property.save === "properties") {
        entry.properties = { ...(entry.properties ?? {}), [property.key]: value }
      } else if (property.save !== false) {
        entry.config[property.key] = value
      }
    }
    if (children.length) entry.children = children
    return entry
  }

  /** The whole hierarchy in the scene file format. */
  private sceneJson(): unknown | null {
    return this.root ? this.serialiseNode(this.root) : null
  }

  private exportSceneFiles(): void {
    const json = this.sceneJson()
    if (json) download("scene.json", JSON.stringify(json, null, 2))
  }

  private async collectFiles(): Promise<{ manifest: ExhibitionManifest; text: Record<string, string> }> {
    const manifest = this.patchedManifest()
    if (!manifest) throw new Error("No manifest to save")
    const text: Record<string, string> = {}

    const sceneJson = this.sceneJson()
    if (sceneJson && typeof manifest.scene === "string") {
      text[manifest.scene] = JSON.stringify(sceneJson, null, 2) + "\n"
    }

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
