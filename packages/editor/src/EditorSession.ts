import { Grid, Mat4, Model, Node3D, Prefab, Quaternion, Slate, UIElement, Vector3, DebugShapes, Visual, editorIcon, uiLayer, exposedProperties, readExposed, writeExposed, type Catalyst, type ExposedProperty, type NodeClass, type NodeJSON, type Script, type VariantJSON, isVariant } from "@nickpaustian/catalyst"
import { Input } from "@nickpaustian/catalyst/input"
import { BoxCollider, MeshCollider, Physics } from "@nickpaustian/catalyst/physics"
import { EditMesh, Primitive } from "@nickpaustian/catalyst/prefabs"
import type { LightspeedRuntime } from "@lightspeed-js/core"
import { EditorCamera, groupTarget, type GizmoMode, isSized, type DrawTool, type DrawnBox, type EditMode } from "./EditorCamera"
import { EditorInput } from "./EditorInput"
import { GridPainter, type GridCommand, type GridPanel } from "./GridPainter"
import { VariantEditing, type VariantView } from "./VariantEditing"
import { History } from "./History"
import { preferences, storage, type SnapSettings, streamingQualityOf, type StreamingPreset } from "./preferences"
import { browserFolders, folderLoader, pickFile, type FolderSource, type ProjectFolder, type ProjectStorage, type RecentProject } from "./ProjectFolder"
import { windowRunnerLink, type RunnerLink } from "./RunnerLink"
import { AssetFolder } from "./AssetFolder"
import { accepts } from "./fileField"
import { SCRIPTS_DIR, ScriptCompiler, plainScriptTemplate, scriptTemplate } from "./ScriptCompiler"
import { BROWSER_DEFAULT, CONNECT_DEFAULT, SignalWiring, declaredBy, labelOf, type ConnectDialog, type SignalBrowser, type SignalsView } from "./SignalWiring"
import type { FiredSignal } from "./signalTap"
import type { ConsoleEntry } from "./consoleTap"
import { LEGACY_PROJECT_FILE, PROJECT_EXTENSION, createProject, readProjectImage, readProjectSettings, writeProjectImage, writeProjectSettings, type NewProject, type ProjectSettings } from "./project"
import { openConfirm } from "./confirm"
import { capturing, dropRecovery, keepRecovery, overlaid, readRecovery, type Recovery } from "./recovery"
import { publish, ZipTarget, type PublishTarget } from "./publish"
import { PREVIEW_DEFAULT, PROJECT_DIALOG_DEFAULT, STREAMABLE_DEFAULT } from "./cells"
import { MAP_NAMES, type AssetConverter, type StreamableJob, type StreamableOptions } from "./converter"
import { Previews } from "./previews"
import type { NodeKind, Recipe } from "./recipe"
import { SlateEditor, type UILayout } from "./ui/SlateEditor"

export interface TreeRow {
  id: number
  name: string
  type: string
  icon: string
  depth: number
  hasChildren: boolean
  expanded: boolean
  isRoot: boolean
  hiddenInEditor: boolean
  hiddenAbove: boolean
}

export interface TreeSelection {
  ids: number[]
  /** The one the fields panel and gizmo pivot follow; the last clicked. */
  active: number | null
}

export type DropPlace = "before" | "after" | "inside"

export interface KindNode {
  id: string
  label: string
  icon: string
  description: string
  /** The kind to send with `add`, or null for a base class that only groups. */
  kind: string | null
  children: KindNode[]
}

/** replace: plain click, toggle: ctrl/cmd click, range: shift click from the anchor. */
export type SelectMode = "replace" | "toggle" | "range"

export interface SelectionProperty extends ExposedProperty {
  label: string
  value: unknown
  /** For a `file`: the project's files it accepts, by path. */
  choices?: string[]
  /** For a recipe setting: the heading it is listed under. */
  section?: string
  /** For a script's field: the base class that declares it, when the script's own class doesn't. */
  origin?: string | null
}

/** A script on the selected node: built, with its fields, or still named by a file that could not be built. */
export interface SelectionScript {
  index: number
  url: string
  name: string
  /** A built script's class, which its fields are listed under when some come from a base class. */
  className?: string
  built: boolean
  fields: SelectionProperty[]
}

export type ViewMode = "orbit"

/** What the panel shows. Each key is a Lightspeed shared cell. */
export interface EditorCells {
  /** `open` is false until a project is in the viewport; the start screen shows meanwhile. */
  "editor:running": boolean
  "editor:project": { open: boolean; name: string | null; recipe: string; storage: ProjectStorage | null; status: string; supported: boolean; browserStorage: boolean; dirty: boolean }
  /** Projects opened before, for the start screen. */
  "editor:recent": RecentProject[]
  /** How the start screen shows: over the editor, as the whole page of its own window, or not at all here. */
  "editor:startMode": "overlay" | "window" | "off"
  /** The new-project or project-settings dialog: closed when `mode` is null. */
  "editor:projectDialog": typeof PROJECT_DIALOG_DEFAULT
  /** What the files pane's "show in the file manager" item is called, or null where there is none. */
  "editor:reveal": string | null
  /** The file shown in the floating preview window. */
  "editor:preview": typeof PREVIEW_DEFAULT
  /** Making a model streamable: the dialog's choices, the build's progress and its outcome. */
  "editor:streamable": typeof STREAMABLE_DEFAULT
  /** The recipes a project may use. */
  "editor:recipes": string[]
  /** The base file when the file being edited is a variant of one, or null. */
  "editor:variantBase": string | null
  /** In a variant, the tree's nodes the base gives, and those of them this file changes. */
  "editor:variantMarks": { inherited: number[]; overridden: number[] } | null
  /** The selected grid's tile types and the paint tool; null when no grid is selected. */
  "editor:grid": GridPanel | null
  "editor:history": { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null }
  /** The recipe's project-wide settings, or null when it has none. */
  "editor:settings": { title: string; fields: SelectionProperty[] } | null
  "editor:view": { view: ViewMode; visualised: boolean; gizmo: GizmoMode; tool: DrawTool | null; vertexEdit: boolean; editMode: EditMode; physics: boolean; scripts: boolean; snap: SnapSettings; streaming: StreamingPreset; slateEditing: boolean }
  "editor:tree": TreeRow[]
  /** Kept apart from the rows so selecting restyles them without rebuilding the tree. */
  "editor:treeSelection": TreeSelection
  /** The kinds the tree can add, as the class hierarchy they sit in: bases that are not kinds are shown but cannot be added. */
  "editor:kinds": KindNode[]
  /** Set true to open the add dialog; the dialog sets it back. */
  "editor:addDialog": boolean
  /** The script files in the project, offered to attach. */
  "editor:scripts": { path: string; name: string }[]
  /** The project folder's files as a tree, for the files pane; empty with no project. */
  "editor:files": FileTree[]
  /** The file the files pane has selected: its size, when it changed, and a preview of an image. */
  "editor:fileInfo": { path: string; size: number; modified: number; preview: string | null; facts: string } | null
  /** The files the code pane edits: scripts, components and stylesheets. */
  "editor:codeFiles": string[]
  /** A file for the code pane to show, in a tab of its own or brought forward: its text as read, and `draft`, unsaved text to show in its place; no path closes every tab. */
  "editor:code": { path: string | null; text: string; status: string; draft?: string }
  /** News of a file the code pane may have open: saved or reloaded (`text`), what happened (`status`), renamed (`to`) or deleted (`gone`). */
  "editor:codeFile": { path: string; text?: string; status: string; to?: string; gone?: boolean } | null
  /** Bumped when everything should save: the code pane answers with its unsaved file. */
  "editor:saveRequest": number
  /** The code pane's files whose text differs from what was last read or saved. */
  "editor:codeUnsaved": { path: string; text: string }[]
  "editor:selection": {
    id: number
    name: string
    type: string
    icon: string
    count: number
    parent: string | null
    /** The file a prefab instance follows, or null for any other node. */
    prefab: string | null
    /** Buttons the inspector offers for this kind of node. */
    actions: { id: string; label: string; title: string }[]
    /** Whether the node has a place in the scene to show and move; UI nodes on a slate don't. */
    spatial: boolean
    /** Whether the node is a slate or on one, so the slate can be edited on its own. */
    onSlate: boolean
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number }
    properties: SelectionProperty[]
    scripts: SelectionScript[]
    /** In a variant: whether the base has the node, and the fields and scripts this file changes over it. */
    variant: VariantView | null
  } | null
  /** The selected node's signals, who hears them, and what its scripts listen to. */
  "editor:signals": SignalsView | null
  "editor:connect": ConnectDialog
  /** The node-tree file the scene tree shows and saves to, when it isn't the project's own scene. */
  "editor:sceneFile": string | null
  "editor:signalBrowser": SignalBrowser
  /** The signals that fired in the run window since the run began, oldest first, the last few hundred kept. */
  "editor:signalLog": FiredSignal[]
  /** Whether the log shows the signals that fire every frame too. */
  "editor:signalLogFrequent": boolean
  /** What the run window's console said since the run began, oldest first, the last thousand kept; a line said again in a row is counted. */
  "editor:console": ConsoleEntry[]
}

export type EditorCommand =
  | GridCommand
  | { type: "newProject"; name?: string }
  | { type: "openFolder" }
  | { type: "reopenLast" }
  | { type: "openRecent"; id: string }
  | { type: "forgetRecent"; id: string }
  | { type: "locateRecent"; id: string }
  | { type: "closeProject" }
  | { type: "openConnect"; mode: "emit" | "listen"; signal?: string; url?: string; node?: number; edit?: { url: string; index: number } }
  | { type: "closeConnect" }
  | { type: "openScene"; path: string | null }
  | { type: "newVariant"; path: string }
  /** Put a field back to the value the variant's base gives it: `transform`, a node field, or a field of the script at `script`. */
  | { type: "resetOverride"; key: string; script?: number }
  | { type: "clearSignalLog" }
  | { type: "setFrequentSignals"; on: boolean }
  | { type: "clearConsole" }
  | { type: "connectSignal"; source: number | null; signal: string; target: number; url: string | null; call: string; perNode?: boolean; group?: string | null; edit?: { url: string; index: number } | null }
  | { type: "disconnectSignal"; url: string; index: number }
  | { type: "addSignal"; node: number; url: string | null; name: string }
  | { type: "removeSignal"; url: string; index: number }
  | { type: "reloadProject" }
  | { type: "openProjectDialog"; mode: "create" | "edit" }
  | { type: "closeProjectDialog" }
  | { type: "pickLocation" }
  | { type: "checkProjectName"; name: string; location: string | null }
  | { type: "createProject"; name: string; recipe: string; description: string; location: string | null; git?: boolean }
  | { type: "saveProjectSettings"; name: string; description: string; image?: string | null }
  | { type: "save" }
  | { type: "saveAll" }
  | { type: "saveAs" }
  | { type: "download" }
  | { type: "exportSite" }
  | { type: "run" }
  | { type: "stop" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setView"; view: ViewMode }
  | { type: "toggleVisualisers" }
  | { type: "togglePhysics" }
  | { type: "toggleScripts" }
  | { type: "setGizmo"; mode: GizmoMode }
  | { type: "setTool"; tool: DrawTool | null }
  | { type: "addBoundsCollider" }
  | { type: "addMeshCollider" }
  | { type: "nodeAction"; id: string }
  | { type: "convertToMesh" }
  | { type: "setVertexEdit"; on: boolean }
  | { type: "setEditMode"; mode: EditMode }
  | { type: "editSlate"; on: boolean }
  | { type: "extrude" }
  | { type: "setSnap"; snap: Partial<SnapSettings> }
  | { type: "setStreaming"; preset: StreamingPreset }
  | { type: "select"; id: number; mode?: SelectMode }
  | { type: "add"; kind: string; options?: Record<string, unknown> }
  | { type: "toggleExpand"; id: number }
  | { type: "toggleHiddenInEditor"; id: number }
  | { type: "move"; ids: number[]; targetId: number; place: DropPlace }
  | { type: "delete" }
  | { type: "duplicate" }
  | { type: "unparent" }
  | { type: "makePrefab" }
  | { type: "unpackPrefab" }
  | { type: "attachScript"; url: string }
  | { type: "attachScriptTo"; id: number; url: string }
  | { type: "detachScript"; index: number }
  | { type: "setScriptProperty"; index: number; key: string; value: unknown; pick?: boolean }
  | { type: "newScript"; name: string; attach?: boolean }
  | { type: "reloadScripts" }
  | { type: "openScript"; path: string }
  | { type: "openScripts"; paths: string[]; active: string | null }
  | { type: "importAsset"; dir?: string }
  | { type: "importDropped"; dir?: string; files: File[] }
  | { type: "renameFile"; from: string; to: string }
  | { type: "deleteFile"; path: string }
  | { type: "newFolder"; path: string }
  | { type: "fileInfo"; path: string | null }
  | { type: "refreshFiles" }
  | { type: "openFile"; path: string }
  | { type: "addModel"; path: string }
  | { type: "useEnvironment"; path: string }
  | { type: "revealFile"; path: string }
  | { type: "previewStylesheet"; path: string }
  | { type: "preview"; path: string }
  | { type: "closePreview" }
  | { type: "streamable"; path: string }
  | { type: "addTheca"; path: string }
  | { type: "rebuildTheca"; path: string }
  | { type: "streamableStart"; out: string; addToScene: boolean; options: StreamableOptions }
  | { type: "streamableCancel" }
  | { type: "streamableClose" }
  | { type: "saveScript"; path: string; text: string }
  | { type: "draftFile"; path: string; text: string }
  | { type: "closeScript"; path: string }
  | { type: "focus" }
  | { type: "setTransform"; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }
  | { type: "setProperty"; key: string; value: unknown; pick?: boolean }
  | { type: "rename"; name: string }
  | { type: "setSetting"; key: string; value: unknown; pick?: boolean }

const round = (n: number, places = 4) => Number(n.toFixed(places))
const toStrings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : String(value ?? "").split(","))
const LIST_TYPES: ExposedProperty["type"][] = ["tags", "layers"]
export const PREFABS_DIR = "prefabs"
/** Files the code pane edits: scripts, components and stylesheets. */
const CODE_FILE = /\.(ts|js|lsp|css)$/i
/** Of those, the ones the viewport shows as they are typed. */
const PREVIEWED_CODE = /\.(lsp|css)$/i

/** Files the preview window can show: images, and models it turns over. */
const PREVIEWED = /\.(png|jpe?g|webp|gif|avif|svg|glb|gltf|lsp)$/i
const PREVIEWED_MODEL = /\.(glb|gltf)$/i

/** A streamed surface's package, as Iapetus writes it: a folder that stands as one asset. */
const THECA = /\.theca$/i
/** The manifest at the top of a theca. */
const THECA_MANIFEST = "theca.json"

/** What the editor reads of a theca's manifest. */
interface ThecaManifest {
  name?: string
  source?: { path?: string; mesh?: number; meshName?: string | null }
  builder?: string
  options?: { permissive?: boolean; partition?: boolean; maxTexture?: number; quality?: number; maps?: { role: string; path: string }[] }
  /** Made by `iapetus pack` from an earlier build, so there are no build options to repeat. */
  packed?: boolean
  triangles?: number
  clusters?: string | null
  hierarchy?: { clusters?: number; pages?: number; levels?: number; bytes?: number }
  tiles?: string | null
  maps?: { role: string; size: number; bytes?: number }[]
  thumbnail?: string | null
  warnings?: string[]
}

/** The assets folder, where imported files go. */
export const ASSETS_DIR = "assets"

/** A file or folder in the project, with a folder's children listed. */
export interface FileTree {
  path: string
  name: string
  kind: "file" | "directory"
  children?: FileTree[]
}

/** Folders never listed in the files pane. */
const HIDDEN_DIRS = new Set(["node_modules", ".git"])
/** Images up to this size get a preview in the files pane. */
const PREVIEW_BYTES = 6 * 1024 * 1024
const PREFAB_KIND = "prefab:"
const slug = (name: string) => name.trim().toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "prefab"

const download = (name: string, text: string | Blob) => {
  const url = URL.createObjectURL(typeof text === "string" ? new Blob([text], { type: "application/json" }) : text)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** Whether `inner` is `outer` or a folder inside it, as far as the two can tell. */
const isWithin = async (inner: ProjectFolder, outer: ProjectFolder): Promise<boolean> => {
  const a = inner.transfer(), b = outer.transfer()
  if (a.kind === "path" && b.kind === "path") return a.path === b.path || a.path.startsWith(`${b.path.replace(/[\\/]+$/, "")}/`)
  if (a.kind === "handle" && b.kind === "handle") return (await a.handle.isSameEntry(b.handle)) || (await b.handle.resolve(a.handle)) !== null
  return false
}

/** The confirm dialog as a yes or no; closed with Escape, a no. */
const confirmed = (title: string, message: string, yes: string): Promise<boolean> =>
  new Promise((resolve) => openConfirm(title, message, [{ label: "Cancel", run: () => resolve(false) }, { label: yes, primary: true, run: () => resolve(true) }], () => resolve(false)))

const AUTOSAVE_DELAY = 2000
const SIGNAL_LOG_KEPT = 500
const CONSOLE_KEPT = 1000

/** How long ago `time` was, as a phrase. */
const ago = (time: number): string => {
  const minutes = Math.round((Date.now() - time) / 60000)
  if (minutes < 1) return "moments ago"
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  return `on ${new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`
}

/**
 * The editor's logic, with no DOM of its own. It publishes what the panel
 * shows into Lightspeed cells and acts on the commands the panel sends
 * back, so the view is plain components that never touch the scene. One
 * session edits one project under a recipe; `open` swaps the scene while
 * the engine, its canvas and the panel stay up.
 */
export class EditorSession {
  readonly engine: Catalyst
  readonly recipe: Recipe
  private readonly app: LightspeedRuntime
  private readonly camera: EditorCamera
  private readonly grids: GridPainter
  private readonly variants: VariantEditing
  private readonly slateEditor: SlateEditor
  private readonly input: EditorInput | null
  private folder: AssetFolder | null = null
  private settings: ProjectSettings | null = null
  private unwatch: (() => void) | null = null
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  private changedOnDisk = new Set<string>()
  private _root: Node3D | null = null
  private view: ViewMode = "orbit"
  private visualised = true
  private gizmo: GizmoMode = "translate"
  private snap: SnapSettings = preferences.snap
  private snapInverted = false
  private streaming: StreamingPreset = preferences.streaming
  private filesGeneration = 0
  /** Every file in the project by path, as the files pane last listed them. */
  private projectFiles: string[] = []
  private readonly history = new History()
  private readonly wiring: SignalWiring
  private dragStart: { node: Node3D; before: Mat4; size: Vector3 | null }[] | null = null
  private vertexDragStart: { mesh: EditMesh; before: number[] } | null = null
  /** The outlines drawn for editable meshes that are hidden but still collide, so they stay findable while editing. */
  private readonly ghosts = new Map<EditMesh, { visual: Visual; version: number; world: Mat4 }>()
  private unsubscribeGhosts: (() => void) | null = null
  private selected: Node3D | null = null
  private selection = new Set<Node3D>()
  private anchor: Node3D | null = null
  private ids = new Map<Node3D, number>()
  private nodesById = new Map<number, Node3D>()
  /** The nodes the tree was last built from, to tell when a selection change must rebuild it. */
  private treeNodes: Node3D[] = []
  private nextId = 1
  private collapsed = new Set<Node3D>()
  private hidden: { key: string; saved: string } | null = null
  private prefabs: { path: string; name: string }[] = []
  private scriptFiles: { path: string; name: string }[] = []
  private compiler: ScriptCompiler | null = null
  private unsubscribeCommands: () => void
  private unsubscribeBlur: () => void
  private readonly folders: FolderSource
  private readonly runner: RunnerLink
  private readonly converter: AssetConverter | null
  /** The desktop app's way to show a file in Finder or Explorer; null in the browser, which has none. */
  private readonly reveal: { label: string; run: (path: string) => Promise<void> } | null
  private streamJob: StreamableJob | null = null
  private streamCancelled = false
  private readonly previews = new Previews()
  /** Unsaved text of the component or stylesheet open in the code pane, by path. */
  private readonly drafts = new Map<string, string>()
  private runnerReady = false
  private readonly unsubscribeRunner: () => void
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "Shift") this.setSnapInverted(false)
  }
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Shift") this.setSnapInverted(true)
    if (event.key === "Escape" && this.slateEditor.slate && !isTyping(event.target)) {
      this.editSlate(false)
      return
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === "r" && !event.shiftKey) {
      event.preventDefault()
      void this.run()
      return
    }
    if (key === "s" && !event.shiftKey) {
      event.preventDefault()
      void this.saveAll()
      return
    }
    if (key === "d" && !event.shiftKey) {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      event.preventDefault()
      this.duplicateSelected()
      return
    }
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
    if (key === "a" && event.shiftKey) {
      event.preventDefault()
      this.app.shared("editor:addDialog").set(true)
    } else if (key === "z" && !event.shiftKey) {
      event.preventDefault()
      this.undo()
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault()
      this.redo()
    }
  }

  constructor(options: { app: LightspeedRuntime; engine: Catalyst; recipe: Recipe; folders?: FolderSource; runner?: RunnerLink; converter?: AssetConverter; reveal?: { label: string; run: (path: string) => Promise<void> } }) {
    this.app = options.app
    this.engine = options.engine
    this.recipe = options.recipe
    this.folders = options.folders ?? browserFolders
    this.runner = options.runner ?? windowRunnerLink()
    this.converter = options.converter ?? null
    this.reveal = options.reveal ?? null
    const unsubscribeReady = this.runner.onReady(() => {
      this.runnerReady = true
      void this.sendToRunner()
    })
    const unsubscribeClosed = this.runner.onClosed(() => {
      this.runnerReady = false
      this.set("editor:running", false)
      if (this.app.shared("editor:project").value?.status === "running") this.publishProject()
    })
    const unsubscribeFailed = this.runner.onFailed?.((reason) => this.publishProject(`the run window could not be opened: ${reason}`)) ?? (() => undefined)
    const unsubscribeReport =
      this.runner.onReport?.((report) => {
        if (report.type === "catalyst:signals") {
          const log = (this.app.shared("editor:signalLog").value as FiredSignal[] | undefined) ?? []
          this.set("editor:signalLog", [...log, ...report.fired].slice(-SIGNAL_LOG_KEPT))
        } else this.heardConsole(report.entries)
      }) ?? (() => undefined)
    this.unsubscribeRunner = () => {
      unsubscribeReady()
      unsubscribeClosed()
      unsubscribeFailed()
      unsubscribeReport()
    }
    this.camera = new EditorCamera(this.engine)
    this.variants = new VariantEditing(this.engine)
    this.grids = new GridPainter({
      camera: this.camera,
      selected: () => this.selected,
      record: (label, undo, redo, key) => this.record(label, undo, redo, key),
      publish: (panel) => this.set("editor:grid", panel),
    })
    uiLayer(this.engine)?.setAttribute("inert", "")
    this.slateEditor = new SlateEditor({
      engine: this.engine,
      select: (node) => this.select(node),
      selected: () => this.selected,
      changed: (node) => {
        if (this.selected === node) this.publishSelection()
      },
      commit: (node, before, after) => this.record(`move ${node.name}`, () => this.writeLayout(node, before), () => this.writeLayout(node, after)),
      closed: () => this.publishView(),
      scripts: {
        running: () => this.engine.scripts.running,
        toggle: () => this.toggleScripts(),
      },
    })
    for (const { kind, cls } of this.recipe.kinds) if (!this.engine.registry.has(kind) && typeof cls === "function") this.engine.register({ [kind]: cls as NodeClass })
    const input = this.engine.find(Input)
    this.input = input ? new EditorInput(input, { focusSelected: () => this.focusSelected(), deleteSelected: () => this.deleteSelected(), moveTool: () => this.setGizmo("translate"), rotateTool: () => this.setGizmo("rotate"), scaleTool: () => this.setGizmo("scale"), boxTool: () => this.setTool("box"), colliderTool: () => this.setTool("collider"), vertexTool: () => this.setVertexEdit(!this.camera.vertexEdit), vertexMode: () => this.setEditMode("vertex"), edgeMode: () => this.setEditMode("edge"), faceMode: () => this.setEditMode("face"), extrude: () => this.extrude(), paintTool: () => void this.handle({ type: "gridPaint" }) }) : null
    const physics = this.engine.find(Physics)
    if (physics) physics.paused = true
    this.engine.scripts.setRunning(false, this.engine.root, this.engine)
    this.wiring = new SignalWiring({
      engine: this.engine,
      root: () => this._root,
      idOf: (node) => this.idOf(node as Node3D),
      nodeById: (id) => this.nodesById.get(id) ?? null,
      editScript: (url, edit) => this.editScript(url, edit),
      newScriptFor: (node) => this.newScriptFor(node),
      setScriptField: (node, url, key, value) => this.setScriptField(node, url, key, value),
      prefabFiles: () => this.prefabFiles(),
      sceneFile: () => this.sceneFile,
    })
    this.history.onChange = () => {
      this.variants.stale()
      this.publishVariantMarks()
      this.publishHistory()
      this.publishProject()
      this.autosaveSoon()
    }
    this.camera.onDrag = (dragging) => (dragging ? this.beginDrag() : this.endDrag())
    this.unsubscribeGhosts = this.engine.signals.onRender.subscribe(() => this.placeGhosts(), 40)
    this.camera.onDrawBox = (box) => void this.addDrawnBox(box)
    this.camera.onClick = (x, y, mode) => {
      if (!this._root) return
      const node = this.camera.pick(x, y, this._root)
      if (node) this.select(node, mode)
      else if (mode === "replace") this.select(null)
    }
    this.camera.onMarquee = (rect, add) => {
      if (this._root) this.selectMany(this.camera.nodesIn(rect, this._root), add)
    }
    this.unsubscribeCommands = this.app.shared("editor:command").subscribe((command) => {
      if (command) void this.handle(command as EditorCommand).catch((error: unknown) => {
        console.error(`[catalyst-editor] ${(command as EditorCommand).type} failed`, error)
        this.publishProject(`${(command as EditorCommand).type} failed: ${error instanceof Error ? error.message : error}`)
      })
    })
    const pause = () => this.engine.pause()
    const resume = () => this.engine.resume()
    window.addEventListener("blur", pause)
    window.addEventListener("focus", resume)
    window.addEventListener("keydown", this.onKeyDown)
    window.addEventListener("keyup", this.onKeyUp)
    this.applySnap()
    this.unsubscribeBlur = () => {
      window.removeEventListener("blur", pause)
      window.removeEventListener("focus", resume)
      window.removeEventListener("keydown", this.onKeyDown)
      window.removeEventListener("keyup", this.onKeyUp)
    }
    this.publishKinds()
    this.publishProject()
    this.publishHistory()
    this.publishSettings()
    this.applyStreaming()
    this.publishView()
    this.publishTree()
    this.publishSelection()
    this.set("editor:scripts", [])
    this.set("editor:files", [])
    this.set("editor:codeFiles", [])
    this.set("editor:fileInfo", null)
    this.set("editor:code", { path: null, text: "", status: "" })
    this.set("editor:saveRequest", 0)
    this.set("editor:codeFile", null)
    this.set("editor:signals", null)
    this.set("editor:sceneFile", null)
    this.set("editor:connect", CONNECT_DEFAULT)
    this.set("editor:signalBrowser", BROWSER_DEFAULT)
    this.set("editor:signalLog", [])
    this.set("editor:signalLogFrequent", false)
    this.set("editor:console", [])
    this.set("editor:codeUnsaved", [])
    this.app.shared("editor:codeUnsaved").subscribe(() => this.autosaveSoon())
    this.set("editor:projectDialog", PROJECT_DIALOG_DEFAULT)
    this.set("editor:streamable", { ...STREAMABLE_DEFAULT, available: this.converter !== null })
    this.set("editor:preview", PREVIEW_DEFAULT)
    this.set("editor:reveal", this.reveal ? this.reveal.label : null)
    this.set("editor:recipes", [this.recipe.name])
    this.setView("orbit")
    void this.publishRecent()
  }

  get root(): Node3D | null {
    return this._root
  }

  /**
   * Put a project in the viewport: the folder's, or a fresh one when there is no folder. Unsaved work is asked about first
   * unless `discarding`. `scene` is a node-tree file of the project to edit instead of its own scene (a level, a prefab).
   */
  async open(source: ProjectFolder | null, { discarding = false, scene = null as string | null } = {}): Promise<void> {
    if (!discarding && !(await this.leave())) return
    this.close()
    this.sceneFile = scene
    const folder = source ? await AssetFolder.open(source) : null
    this.folder = folder
    this.settings = folder ? await readProjectSettings(folder) : null
    this.engine.loader = folder ? this.loaderFor(folder) : this.engine.loader
    this.useFolderScripts()
    this.set("editor:code", { path: null, text: "", status: "" })
    this.set("editor:projectDialog", PROJECT_DIALOG_DEFAULT)
    this.publishProject(folder ? `opening ${folder.name}` : "new project")
    const recovery = folder ? await this.offerRecovery(folder) : null
    this.recoveryKept = recovery !== null
    if (recovery) this.sceneFile = recovery.scene ?? null
    this.set("editor:sceneFile", this.sceneFile)
    const root = await this.loadRoot(folder && recovery ? overlaid(folder, recovery.files) : folder)
    this._root = root
    this.engine.add(root)
    void this.whenScriptsBuilt(root)
    this.setVisualised(this.visualised)
    await this.loadPrefabs()
    await this.loadScriptFiles()
    this.history.clear()
    if (recovery && Object.keys(recovery.files).length) this.history.markUnsaved()
    this.publishSettings()
    this.publishProject(folder ? "" : "unsaved")
    if (folder) await this.relinkAssets(folder)
    this.restoreHidden()
    this.publishTree()
    this.select(null)
    this.camera.focusPoint(new Vector3(0, 0.5, 0), 8)
    if (folder) await folder.remember()
    void this.publishRecent()
    if (folder && recovery) await this.restoreCode(folder, recovery.code)
    if (folder?.watch) {
      try {
        this.unwatch = await folder.watch((paths) => this.onDiskChange(paths))
      } catch (error) {
        this.engine.log(`the project folder is not watched: ${error instanceof Error ? error.message : error}`, "editor")
      }
    }
  }

  /** Read the project's files again and rebuild the scene from them, dropping unsaved changes. */
  async reloadProject({ discarding = false } = {}): Promise<void> {
    const folder = this.folder
    if (!folder) return
    if (!discarding && !(await this.leave())) return
    await this.open(folder, { discarding: true, scene: this.sceneFile })
    this.publishProject("reloaded from disk")
  }

  /** Once the scene's scripts are built (they load after the project opens), show the signals they add and connect. */
  private async whenScriptsBuilt(root: Node3D): Promise<void> {
    const loading: Promise<void>[] = []
    root.walk((node) => void loading.push(node.scriptsReady))
    await Promise.allSettled(loading)
    if (this._root !== root) return
    this.signalsShown.stale = true
    this.publishSelection()
  }

  /** The node-tree file being edited instead of the project's own scene, or null for that scene. */
  private sceneFile: string | null = null
  /** The open file's root had a transform of its own; a prefab's doesn't, its copies carrying one. */
  private sceneFileHasTransform = false

  /** The scene tree's root: the project's scene through the recipe, or the open node-tree file as it is. */
  private async loadRoot(folder: ProjectFolder | null): Promise<Node3D> {
    this.variants.close()
    this.set("editor:variantBase", null)
    if (!this.sceneFile || !folder) return this.recipe.load(folder, this.engine)
    const file = await folder.readJSON<NodeJSON | VariantJSON>(this.sceneFile)
    const json = await this.variants.open(file, this.sceneFile, (path) => folder.readJSON<NodeJSON | VariantJSON>(path))
    this.set("editor:variantBase", this.variants.base)
    this.sceneFileHasTransform = json.transform !== undefined
    const made = this.engine.create(json)
    if (made instanceof Node3D) return made
    const wrapped = new Node3D("scene")
    wrapped.addNode(made)
    return wrapped
  }

  /** Write the tree back where it came from; gives back what was written. */
  private async writeRoot(folder: ProjectFolder, root: Node3D): Promise<string[]> {
    if (!this.sceneFile) return this.recipe.save(folder, root, this.engine)
    const variant = this.variants.save(root)
    const json = variant ?? this.engine.serialise(root)
    if (!variant && !this.sceneFileHasTransform) delete (json as NodeJSON).transform
    await folder.writeJSON(this.sceneFile, json)
    this.engine.prefabs.invalidate(this.sceneFile)
    return [this.sceneFile]
  }

  /** Edit a node-tree file of the project in the scene tree (a level, a prefab), or the project's own scene with null. */
  private async openScene(path: string | null): Promise<void> {
    const folder = this.folder
    if (!folder || path === this.sceneFile) return
    if (path !== null && path === this.recipe.files?.[0]) return this.openScene(null)
    if (!(await this.leave())) return
    // Nothing is unsaved now, so whatever autosave kept goes before the next file opens, rather than being offered back.
    await this.autosave()
    if (path !== null) {
      const json = await folder.readJSON<{ type?: unknown }>(path).catch(() => null)
      if (typeof json?.type !== "string" && !isVariant(json)) return this.publishProject(`${path} isn't a node tree to edit`)
    }
    await this.open(folder, { discarding: true, scene: path })
    this.publishProject(path ? `editing ${path}` : "editing the project's scene")
  }

  /** Take the project out of the viewport and show the start screen again. */
  async closeProject(): Promise<void> {
    if (!(await this.leave())) return
    this.close()
    this.folder = null
    this.settings = null
    this.set("editor:code", { path: null, text: "", status: "" })
    this.publishSettings()
    this.publishTree()
    this.publishProject()
    void this.publishRecent()
  }

  private get unsavedCode(): EditorCells["editor:codeUnsaved"] {
    return (this.app.shared("editor:codeUnsaved").value as EditorCells["editor:codeUnsaved"] | undefined) ?? []
  }

  /** Whether closing the project now would lose anything: scene edits or the code pane's file. */
  get hasUnsavedWork(): boolean {
    return Boolean(this._root) && (this.history.isDirty || this.unsavedCode.length > 0)
  }

  /**
   * Ask before unsaved work is lost: save it, drop it, or stay. True when the
   * project may go; a cancelled question, or a save that did not happen, is false.
   */
  async leave(): Promise<boolean> {
    if (!this.hasUnsavedWork) return true
    const name = this.settings?.name ?? this.folder?.name ?? "this project"
    const choice = await new Promise<"save" | "discard" | "stay">((resolve) =>
      openConfirm(`Save changes to ${name}?`, "Your changes are lost if you don't save them.", [
        { label: "Cancel", run: () => resolve("stay") },
        { label: "Don't save", run: () => resolve("discard") },
        { label: "Save", primary: true, run: () => resolve("save") },
      ], () => resolve("stay")),
    )
    if (choice === "stay") return false
    if (choice === "discard") {
      await this.dropRecovery()
      return true
    }
    await this.saveUnsavedCode()
    if (this.history.isDirty) {
      if (this.folder) await this.save(this.folder)
      else await this.saveAs()
    }
    await this.autosave()
    return !this.hasUnsavedWork
  }

  private autosaveTimer: ReturnType<typeof setTimeout> | null = null
  /** Whether this project has unsaved work kept in the recovery store, from this session or one before. */
  private recoveryKept = false

  /** Keep the unsaved work a moment after the last change, so a crash or a forced quit loses at most that moment. */
  private autosaveSoon(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null
      void this.autosave().catch((error: unknown) => this.engine.log(`unsaved work could not be kept: ${error instanceof Error ? error.message : error}`, "editor"))
    }, AUTOSAVE_DELAY)
  }

  /** What a save would write, and the code pane's unsaved file, into the recovery store; with nothing unsaved, the kept work goes. */
  private async autosave(): Promise<void> {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    this.autosaveTimer = null
    const folder = this.folder
    const root = this._root
    if (!folder || !root) return
    if (!this.hasUnsavedWork) {
      if (this.recoveryKept) await this.dropRecovery()
      return
    }
    const capture = capturing(folder)
    if (this.history.isDirty) await this.writeRoot(capture.folder, root)
    await keepRecovery(folder, { kept: Date.now(), files: capture.files, code: this.unsavedCode, scene: this.sceneFile })
    this.recoveryKept = true
  }

  private async dropRecovery(): Promise<void> {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    this.autosaveTimer = null
    if (this.folder) await dropRecovery(this.folder)
    this.recoveryKept = false
  }

  /** Unsaved work kept from a session that ended without saving: restored, thrown away, or (dismissed) left for next time. */
  private async offerRecovery(folder: ProjectFolder): Promise<Recovery | null> {
    const recovery = await readRecovery(folder).catch(() => null)
    if (!recovery) return null
    const name = this.settings?.name ?? folder.name
    const what = [Object.keys(recovery.files).length ? (recovery.scene ?? "the scene") : "", ...recovery.code.map((file) => file.path)].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1")
    return new Promise((resolve) =>
      openConfirm(`Restore unsaved changes to ${name}?`, `Changes to ${what} from ${ago(recovery.kept)} were never saved.\nRestore them to carry on where you left off, or discard them and open what is saved.`, [
        { label: "Discard", run: () => void dropRecovery(folder).then(() => resolve(null), () => resolve(null)) },
        { label: "Restore", primary: true, run: () => resolve(recovery) },
      ], () => resolve(null)),
    )
  }

  /** The code pane's unsaved files as they were kept, each shown unsaved over what is on disk. */
  private async restoreCode(folder: ProjectFolder, code: Recovery["code"]): Promise<void> {
    for (const file of code) {
      const text = await folder.readText(file.path).catch(() => "")
      this.set("editor:code", { path: file.path, text, status: "restored unsaved changes", draft: file.text })
    }
  }

  /** Write the code pane's unsaved files here and now, not through the pane, so they are on disk before the project goes. */
  private async saveUnsavedCode(): Promise<void> {
    if (!this.folder) return
    for (const file of this.unsavedCode) await this.saveScript(file.path, file.text)
    this.set("editor:codeUnsaved", [])
  }

  private close(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    this.autosaveTimer = null
    this.unwatch?.()
    this.unwatch = null
    this.select(null)
    this._root?.dispose()
    this._root = null
    this.variants.close()
    this.ids.clear()
    this.nodesById.clear()
    this.collapsed.clear()
    this.hidden = null
    this.drafts.clear()
  }

  dispose(): void {
    this.previews.dispose()
    this.unsubscribeGhosts?.()
    for (const ghost of this.ghosts.values()) {
      this.engine.scene.remove(ghost.visual)
      this.engine.renderer?.release(ghost.visual.geometry)
    }
    this.ghosts.clear()
    this.close()
    this.unsubscribeCommands()
    this.unsubscribeBlur()
    this.unsubscribeRunner()
    this.input?.deactivate()
    this.camera.dispose()
  }

  //=========================
  // Publishing
  //=========================

  private set<K extends keyof EditorCells>(key: K, value: EditorCells[K]): void {
    this.app.shared(key).set(value)
  }

  private publishKinds(): void {
    const nodes = new Map<object, KindNode>()
    const roots: KindNode[] = []
    const nodeFor = (cls: any): KindNode => {
      let node = nodes.get(cls)
      if (node) return node
      node = { id: cls.name, label: cls.name, icon: editorIcon(cls), description: "", kind: null, children: [] }
      nodes.set(cls, node)
      const base = Object.getPrototypeOf(cls)
      if (base && base !== Function.prototype && base.name) nodeFor(base).children.push(node)
      else roots.push(node)
      return node
    }
    for (const { kind, label, cls, description } of this.recipe.kinds) {
      const node = nodeFor(cls)
      node.kind = kind
      node.label = label
      node.description = description ?? ""
    }
    const sort = (list: KindNode[]) => {
      list.sort((a, b) => a.label.localeCompare(b.label))
      for (const node of list) sort(node.children)
    }
    sort(roots)
    if (this.prefabs.length) {
      roots.push({
        id: "Prefabs",
        label: "Prefabs",
        icon: editorIcon(Prefab),
        description: `The node trees saved under ${PREFABS_DIR}/ in this project. Edit → Make prefab saves the selected node as one.`,
        kind: null,
        children: this.prefabs.map(({ path, name }) => ({ id: `${PREFAB_KIND}${path}`, label: name, icon: editorIcon(Prefab), description: `A copy of ${path}. Every copy follows the file.`, kind: `${PREFAB_KIND}${path}`, children: [] })),
      })
    }
    this.set("editor:kinds", roots)
    this.set("editor:addDialog", false)
  }

  private async publishRecent(): Promise<void> {
    this.set("editor:recent", await this.folders.recent())
  }

  private publishProject(status?: string): void {
    const dirty = this.history.isDirty
    this.set("editor:project", { open: this._root !== null, name: this.settings?.name ?? this.folder?.name ?? null, recipe: this.recipe.name, storage: this.folder?.storage ?? null, status: status ?? (dirty ? "unsaved changes" : ""), supported: this.folders.isSupported, browserStorage: this.folders.hasBrowserStorage, dirty })
  }

  /** Every node in the scene by its path, for a `node` field to choose from; made again when the tree changes. */
  private nodePaths: string[] | null = null

  /** A property as the panels show it; a `file` lists the project's files it accepts, a `node` the scene's nodes. */
  private field(property: ExposedProperty, value: unknown): SelectionProperty {
    const field: SelectionProperty = { ...property, label: property.label ?? property.key, value }
    if (property.type === "file") field.choices = this.projectFiles.filter((path) => accepts(property.accept, path) && !this.recipe.files?.includes(path))
    if (property.type === "node") {
      const root = this._root
      if (!this.nodePaths && root) {
        const paths: string[] = []
        root.walk((node) => void (node !== root && paths.push(labelOf(node, root))))
        this.nodePaths = paths
      }
      field.choices = this.nodePaths ?? []
    }
    return field
  }

  private publishSettings(): void {
    const settings = this.recipe.settings
    if (!settings || !this._root) return this.set("editor:settings", null)
    const values = settings.read(this.engine, this._root)
    this.set("editor:settings", { title: settings.title, fields: settings.fields.map((field) => this.field(field, values[field.key])) })
  }

  private publishHistory(): void {
    this.set("editor:history", { canUndo: this.history.canUndo, canRedo: this.history.canRedo, undoLabel: this.history.undoLabel, redoLabel: this.history.redoLabel })
  }

  /** The viewport's streaming cap from the preference; a run's engine is separate and keeps the scene's own. */
  private applyStreaming(): void {
    Object.assign(this.engine.streaming, streamingQualityOf(this.streaming))
  }

  private publishView(): void {
    this.set("editor:view", { view: this.view, visualised: this.visualised, gizmo: this.gizmo, tool: this.camera.tool, vertexEdit: this.camera.vertexEdit, editMode: this.camera.editMode, physics: !(this.engine.find(Physics)?.paused ?? true), scripts: this.engine.scripts.running, snap: this.snap, streaming: this.streaming, slateEditing: this.slateEditor.slate !== null })
  }

  //=========================
  // History
  //=========================

  private record(label: string, undo: () => void, redo: () => void, key?: string): void {
    this.history.push({ label, undo, redo, key })
  }

  undo(): void {
    if (this.history.undo()) this.refresh()
  }

  redo(): void {
    if (this.history.redo()) this.refresh()
  }

  /** After a change made by the history rather than a command: the tree, the fields and the gizmo catch up. */
  private refresh(): void {
    for (const node of [...this.selection]) if (!node.isInTree) this.selection.delete(node)
    if (this.selected && !this.selected.isInTree) this.selected = [...this.selection].pop() ?? null
    if (this.selected && this.selected !== this._root) this.attachGizmo(this.selected)
    else this.camera.detach()
    this.camera.syncFromTarget()
    this.publishTree()
    this.publishSelection()
  }

  private beginDrag(): void {
    const nodes = this.selection.size > 1 ? this.selectionRoots() : this.selected ? [this.selected] : []
    this.dragStart = nodes.map((node) => ({ node, before: node.transform.worldMatrix.clone(), size: sizeOf(node) }))
    this.vertexDragStart = this.selected instanceof EditMesh && this.camera.vertexEdit ? { mesh: this.selected, before: this.selected.vertices } : null
  }

  private endDrag(): void {
    const vertexDrag = this.vertexDragStart
    this.vertexDragStart = null
    if (vertexDrag) {
      const { mesh, before } = vertexDrag
      const after = mesh.vertices
      if (before.some((v, i) => v !== after[i])) this.record("move vertices", () => (mesh.vertices = before), () => (mesh.vertices = after))
      this.publishSelection()
      return
    }
    const start = this.dragStart
    this.dragStart = null
    if (!start || start.length === 0) return
    const moves = start.map(({ node, before, size }) => ({ node, before, after: node.transform.worldMatrix.clone(), sizeBefore: size, sizeAfter: sizeOf(node) }))
    if (moves.every(({ before, after, sizeBefore, sizeAfter }) => before.equals(after) && (!sizeBefore || !sizeAfter || sizeBefore.equals(sizeAfter)))) return
    const place = (which: "before" | "after") => () => {
      for (const move of moves) {
        move.node.transform.setWorldMatrix(move[which])
        const size = which === "before" ? move.sizeBefore : move.sizeAfter
        if (size && isSized(move.node)) move.node.resize(size.x, size.y, size.z)
      }
    }
    this.record(this.gizmo === "rotate" ? "rotate" : this.gizmo === "scale" ? "scale" : "move", place("before"), place("after"))
    this.publishSelection()
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

  /** The children that are scene content: spatial, and not a prefab's own internals. */
  private ownedChildren(node: Node3D): Node3D[] {
    return node.getChildren().filter((child): child is Node3D => child instanceof Node3D && !child.internal)
  }

  private visibleNodes(): { node: Node3D; depth: number; hiddenAbove: boolean }[] {
    const rows: { node: Node3D; depth: number; hiddenAbove: boolean }[] = []
    const visit = (node: Node3D, depth: number, hiddenAbove: boolean) => {
      rows.push({ node, depth, hiddenAbove })
      if (!this.collapsed.has(node)) this.ownedChildren(node).forEach((child) => visit(child, depth + 1, hiddenAbove || node.hiddenInEditor))
    }
    if (this._root) visit(this._root, 0, false)
    return rows
  }

  /** The selected node's signals, worked out again only when the selection, the tree or the scripts change, not on every move. */
  private signalsShown: { node: Node3D | null; stale: boolean } = { node: null, stale: true }

  private publishSignals(): void {
    const node = this.selected
    const stale = this.signalsShown.stale
    if (!stale && this.signalsShown.node === node) return
    this.signalsShown = { node, stale: false }
    this.set("editor:signals", node ? this.wiring.view(node) : null)
    if (stale) this.set("editor:signalBrowser", this.wiring.browser())
  }

  private publishTree(): void {
    this.signalsShown.stale = true
    this.nodePaths = null
    this.rememberHidden()
    this.set(
      "editor:tree",
      this.visibleNodes().map(({ node, depth, hiddenAbove }) => ({
        id: this.idOf(node),
        name: node.name,
        type: this.engine.registry.typeOf(node),
        icon: editorIcon(node),
        depth,
        hasChildren: this.ownedChildren(node).length > 0,
        expanded: !this.collapsed.has(node),
        isRoot: node === this._root,
        hiddenInEditor: node.hiddenInEditor,
        hiddenAbove,
      })),
    )
    this.treeNodes = this.sceneNodes()
    this.publishTreeSelection()
    this.publishVariantMarks()
  }

  private publishVariantMarks(): void {
    const root = this._root
    const marks = root ? this.variants.marks(root, this.sceneNodes()) : null
    this.set("editor:variantMarks", marks && { inherited: marks.inherited.map((node) => this.idOf(node as Node3D)), overridden: marks.overridden.map((node) => this.idOf(node as Node3D)) })
  }

  /** Every scene node in tree order, collapsed or not. */
  private sceneNodes(): Node3D[] {
    const nodes: Node3D[] = []
    const visit = (node: Node3D) => {
      nodes.push(node)
      this.ownedChildren(node).forEach(visit)
    }
    if (this._root) visit(this._root)
    return nodes
  }

  /** Selecting restyles the tree's rows, unless nodes were added, removed or moved since it was built: an add or a delete selects after it changes the scene, so the tree is rebuilt then. */
  private publishSelectedRows(): void {
    const nodes = this.sceneNodes()
    if (nodes.length !== this.treeNodes.length || nodes.some((node, i) => node !== this.treeNodes[i])) this.publishTree()
    else this.publishTreeSelection()
  }

  private publishTreeSelection(): void {
    this.set("editor:treeSelection", { ids: [...this.selection].map((node) => this.idOf(node)), active: this.selected ? this.idOf(this.selected) : null })
  }

  /** A node's place in the scene as its names from the root down, which is how the nodes hidden in the editor are remembered. */
  private pathOf(node: Node3D): string {
    const names: string[] = []
    for (let at: Node3D | null = node; at && at !== this._root; at = at.parent instanceof Node3D ? at.parent : null) names.unshift(at.name)
    return names.join("/")
  }

  /**
   * The nodes hidden in the editor are this editor's view, not the scene:
   * kept in this browser's storage under the project, by path, and written
   * again whenever the tree changes, so a rename or move carries them along.
   */
  private restoreHidden(): void {
    const settings = this.settings
    if (!this._root || !this.folder || !settings) return
    const key = `hidden:${settings.name}:${settings.created ?? ""}`
    const paths = new Set(storage.get<string[]>(key, []))
    this._root.walk((node) => {
      if (node instanceof Node3D && paths.has(this.pathOf(node))) node.hiddenInEditor = true
    })
    this.hidden = { key, saved: [...paths].sort().join("\n") }
  }

  private rememberHidden(): void {
    const hidden = this.hidden
    if (!hidden || !this._root) return
    const paths: string[] = []
    this._root.walk((node) => {
      if (node instanceof Node3D && node.hiddenInEditor) paths.push(this.pathOf(node))
    })
    const saved = paths.sort().join("\n")
    if (saved === hidden.saved) return
    hidden.saved = saved
    if (paths.length) storage.set(hidden.key, paths)
    else storage.remove(hidden.key)
  }

  private publishSelection(): void {
    const node = this.selected
    this.publishSignals()
    this.grids.follow()
    if (!node) {
      this.set("editor:selection", null)
      return
    }
    const p = node.transform.position
    const e = node.transform.rotation.toEuler(new Vector3(), "YXZ")
    this.set("editor:selection", {
      id: this.idOf(node),
      name: node.name,
      type: this.engine.registry.typeOf(node),
      icon: editorIcon(node),
      count: this.selection.size,
      parent: node.parent instanceof Node3D && node.parent !== this._root ? node.parent.name : null,
      prefab: node instanceof Prefab ? node.url : null,
      scripts: this.selectionScripts(node),
      actions: this.nodeActions(node),
      spatial: isSpatial(node),
      onSlate: slateOf(node) !== null,
      position: { x: round(p.x), y: round(p.y), z: round(p.z) },
      rotation: { x: round(degrees(e.x), 2), y: round(degrees(e.y), 2), z: round(degrees(e.z), 2) },
      properties: exposedProperties(node)
        .filter((property) => !property.hidden && (!property.shownWhen || property.shownWhen(node)))
        .map((property) => this.field(property, readExposed(node, property)))
        .sort((a, b) => Number(LIST_TYPES.includes(a.type)) - Number(LIST_TYPES.includes(b.type))),
      variant: this._root ? this.variants.view(node, this._root) : null,
    })
  }

  //=========================
  // Commands
  //=========================

  private async handle(command: EditorCommand): Promise<void> {
    if (this.grids.command(command)) return this.publishView()
    switch (command.type) {
      case "newProject":
        await this.newProject(command.name)
        break
      case "openFolder": {
        const folder = await this.folders.pick()
        if (!folder) return
        if (await folder.ensurePermission()) await this.open(folder)
        break
      }
      case "reopenLast": {
        const folder = await this.folders.last()
        if (!folder) return this.publishProject("no folder remembered")
        if (await folder.ensurePermission()) await this.open(folder)
        break
      }
      case "openRecent": {
        const folder = await this.folders.openRecent(command.id)
        if (!folder) {
          await this.folders.forget(command.id)
          await this.publishRecent()
          return this.publishProject("that project is gone")
        }
        if (await folder.ensurePermission()) await this.open(folder)
        break
      }
      case "forgetRecent":
        await this.folders.forget(command.id)
        await this.publishRecent()
        break
      case "locateRecent": {
        const folder = await this.folders.pick()
        if (!folder) return
        await this.folders.forget(command.id)
        if (await folder.ensurePermission()) await this.open(folder)
        break
      }
      case "closeProject":
        await this.closeProject()
        break
      case "openConnect": {
        const node = command.node === undefined ? this.selected : (this.nodesById.get(command.node) ?? null)
        if (node) this.set("editor:connect", await this.wiring.dialog(command.mode, node, command.signal ?? "", command.url ?? null, command.edit ?? null))
        break
      }
      case "closeConnect":
        this.set("editor:connect", CONNECT_DEFAULT)
        break
      case "clearConsole":
        this.set("editor:console", [])
        break
      case "clearSignalLog":
        this.set("editor:signalLog", [])
        break
      case "setFrequentSignals":
        this.set("editor:signalLogFrequent", command.on)
        if (this.runner.isOpen) this.runner.send({ type: "catalyst:options", frequentSignals: command.on })
        break
      case "connectSignal":
        try {
          await this.wiring.connect(command)
          this.set("editor:connect", CONNECT_DEFAULT)
          this.publishProject(`${command.edit ? "changed the connection to" : "connected"} ${command.signal} → ${command.call}`)
        } catch (error) {
          this.set("editor:connect", { ...(this.app.shared("editor:connect").value as ConnectDialog), error: error instanceof Error ? error.message : String(error) })
        }
        break
      case "disconnectSignal":
        await this.wiring.disconnect(command.url, command.index).catch((error: unknown) => this.publishProject(error instanceof Error ? error.message : String(error)))
        break
      case "addSignal":
        await this.wiring.addSignal(command.node, command.url, command.name).catch((error: unknown) => this.publishProject(error instanceof Error ? error.message : String(error)))
        break
      case "removeSignal":
        await this.wiring.removeSignal(command.url, command.index).catch((error: unknown) => this.publishProject(error instanceof Error ? error.message : String(error)))
        break
      case "reloadProject":
        await this.reloadProject()
        break
      case "openProjectDialog":
        await this.openProjectDialog(command.mode)
        break
      case "closeProjectDialog":
        this.set("editor:projectDialog", PROJECT_DIALOG_DEFAULT)
        break
      case "pickLocation": {
        const location = await this.folders.pickLocation()
        if (location) this.set("editor:projectDialog", { ...this.app.shared("editor:projectDialog").value, location })
        break
      }
      case "checkProjectName": {
        const taken = await this.folders.isTaken(command.name, command.location)
        this.set("editor:projectDialog", { ...this.app.shared("editor:projectDialog").value, taken: taken ? command.name : "" })
        break
      }
      case "createProject":
        await this.createProject(command)
        break
      case "saveProjectSettings":
        await this.saveProjectSettings(command.name, command.description, command.image)
        break
      case "save":
        if (this.folder) await this.save(this.folder)
        else await this.saveAs()
        break
      case "saveAll":
        await this.saveAll()
        break
      case "saveAs":
        await this.saveAs()
        break
      case "download": {
        const file = this.recipe.download?.(this._root!, this.engine)
        if (file && this._root) download(file.name, file.text)
        break
      }
      case "exportSite":
        await this.exportSite()
        break
      case "run":
        await this.run()
        break
      case "stop":
        this.runner.close()
        break
      case "undo":
        this.undo()
        break
      case "redo":
        this.redo()
        break
      case "setView":
        this.setView(command.view)
        break
      case "toggleVisualisers":
        this.setVisualised(!this.visualised)
        break
      case "togglePhysics": {
        const physics = this.engine.find(Physics)
        if (physics) physics.paused = !physics.paused
        this.publishView()
        break
      }
      case "toggleScripts":
        this.toggleScripts()
        break
      case "setTool":
        this.setTool(command.tool)
        break
      case "addBoundsCollider":
        this.addBoundsCollider()
        break
      case "addMeshCollider":
        this.addMeshCollider()
        break
      case "nodeAction":
        this.runNodeAction(command.id)
        break
      case "convertToMesh":
        this.convertToMesh()
        break
      case "setVertexEdit":
        this.setVertexEdit(command.on)
        break
      case "editSlate":
        this.editSlate(command.on)
        break
      case "setEditMode":
        this.setEditMode(command.mode)
        break
      case "extrude":
        this.extrude()
        break
      case "setGizmo":
        this.setGizmo(command.mode)
        break
      case "setStreaming":
        this.streaming = command.preset
        preferences.setStreaming(this.streaming)
        this.applyStreaming()
        this.publishView()
        break
      case "setSnap":
        this.snap = { ...this.snap, ...command.snap }
        preferences.setSnap(this.snap)
        this.applySnap()
        this.publishView()
        break
      case "select":
        this.select(this.nodesById.get(command.id) ?? null, command.mode)
        break
      case "add":
        await this.addNode(command.kind, command.options)
        break
      case "toggleHiddenInEditor": {
        const node = this.nodesById.get(command.id)
        if (!node || node === this._root) return
        node.hiddenInEditor = !node.hiddenInEditor
        this.publishTree()
        break
      }
      case "toggleExpand": {
        const node = this.nodesById.get(command.id)
        if (!node) return
        if (this.collapsed.has(node)) this.collapsed.delete(node)
        else this.collapsed.add(node)
        this.publishTree()
        break
      }
      case "move":
        this.moveNodes(command.ids, command.targetId, command.place)
        break
      case "delete":
        this.deleteSelected()
        break
      case "unparent":
        this.unparent()
        break
      case "duplicate":
        this.duplicateSelected()
        break
      case "makePrefab":
        await this.makePrefab()
        break
      case "unpackPrefab":
        await this.unpackPrefab()
        break
      case "attachScriptTo": {
        const node = this.nodesById.get(command.id)
        if (node instanceof Node3D && node !== this._root) await this.attachScript(command.url, node)
        break
      }
      case "attachScript":
        await this.attachScript(command.url)
        break
      case "detachScript":
        this.detachScript(command.index)
        break
      case "setScriptProperty":
        if (command.pick) void this.pickFileFor(command.key, command.index)
        else this.writeScriptProperty(command.index, command.key, command.value)
        break
      case "newScript":
        await this.newScript(command.name, command.attach ?? true)
        break
      case "reloadScripts":
        await this.reloadScripts()
        break
      case "openScript":
        await this.openScript(command.path)
        break
      case "openScripts":
        await this.openScripts(command.paths, command.active)
        break
      case "importAsset":
        await this.importAsset(command.dir)
        break
      case "importDropped":
        await this.importDropped(command.files, command.dir)
        break
      case "renameFile":
        await this.renameFile(command.from, command.to)
        break
      case "deleteFile":
        this.deleteFile(command.path)
        break
      case "newFolder":
        await this.newFolder(command.path)
        break
      case "fileInfo":
        await this.publishFileInfo(command.path)
        break
      case "refreshFiles":
        await this.publishFiles()
        break
      case "openFile":
        if (CODE_FILE.test(command.path)) await this.openScript(command.path)
        else if (/\.json$/i.test(command.path)) await this.openScene(command.path)
        break
      case "openScene":
        await this.openScene(command.path)
        break
      case "newVariant":
        await this.newVariant(command.path)
        break
      case "resetOverride":
        this.resetOverride(command.key, command.script)
        break
      case "draftFile":
        await this.draftFile(command.path, command.text)
        break
      case "addModel":
        await this.addNode("Model", { url: command.path, name: command.path.replace(/^.*\//, "").replace(/\.[^.]+$/, "") })
        break
      case "useEnvironment":
        this.writeSetting("environment", command.path)
        break
      case "revealFile": {
        const absolute = this.absolutePath(command.path)
        if (this.reveal && absolute) await this.reveal.run(absolute.replace(/\/+$/, "")).catch((error: unknown) => this.publishProject(`${command.path} could not be shown: ${error instanceof Error ? error.message : error}`))
        break
      }
      case "preview":
        await this.openPreview(command.path)
        break
      case "previewStylesheet":
        await this.previewStylesheet(command.path)
        break
      case "closePreview":
        this.closePreview()
        break
      case "streamable":
        await this.openStreamable(command.path)
        break
      case "addTheca":
        await this.addTheca(command.path)
        break
      case "rebuildTheca":
        await this.rebuildTheca(command.path)
        break
      case "streamableStart":
        await this.startStreamable(command.out, command.addToScene, command.options)
        break
      case "streamableCancel":
        this.cancelStreamable()
        break
      case "streamableClose":
        if (!this.streamJob) this.setStreamable({ open: false })
        break
      case "saveScript":
        await this.saveScript(command.path, command.text)
        break
      case "closeScript":
        await this.discardDraft(command.path)
        break
      case "focus":
        this.focusSelected()
        break
      case "setTransform":
        this.writeTransform(command.position, command.rotation)
        break
      case "setProperty":
        if (command.pick) void this.pickFileFor(command.key)
        else this.writeProperty(command.key, command.value)
        break
      case "rename":
        this.renameSelected(command.name)
        break
      case "setSetting":
        if (command.pick) void this.pickFileFor(command.key, "setting")
        else this.writeSetting(command.key, command.value)
        break
    }
  }

  /** A fresh project: straight into the browser's storage under a name when one is given, else through the dialog. */
  private async newProject(name?: string): Promise<void> {
    if (name && this.folders.hasBrowserStorage) {
      if (!(await this.leave())) return
      await this.open(await createProject(this.folders, { name, recipe: this.recipe.name, description: "", location: null }), { discarding: true })
      return
    }
    this.openProjectDialog("create")
  }

  private async openProjectDialog(mode: "create" | "edit"): Promise<void> {
    if (mode === "edit" && !this.folder) return
    const current = mode === "edit" ? this.settings : null
    const location = mode === "create" ? await this.folders.defaultLocation() : null
    const image = mode === "edit" ? await readProjectImage(this.folder!, current) : null
    this.set("editor:projectDialog", { ...PROJECT_DIALOG_DEFAULT, mode, name: current?.name ?? (mode === "edit" ? this.folder!.name : PROJECT_DIALOG_DEFAULT.name), recipe: current?.recipe ?? this.recipe.name, description: current?.description ?? "", image, location, locations: this.folders.hasLocations, git: this.folders.canInitGit, canGit: this.folders.canInitGit })
  }

  private async createProject(fields: NewProject): Promise<void> {
    if (!(await this.leave())) return
    try {
      const folder = await createProject(this.folders, fields)
      if (!(await folder.ensurePermission())) return
      await this.open(folder, { discarding: true })
    } catch (error) {
      this.set("editor:projectDialog", { ...this.app.shared("editor:projectDialog").value, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** `image` is a data url to write as the project's picture, null to drop it, or undefined to leave it. */
  private async saveProjectSettings(name: string, description: string, image?: string | null): Promise<void> {
    const folder = this.folder
    if (!folder) return
    const next: ProjectSettings = { ...(this.settings ?? { recipe: this.recipe.name, created: new Date().toISOString() }), name: name.trim() || folder.name, description: description.trim() }
    if (image === null) next.image = null
    else if (image) next.image = await writeProjectImage(folder, image)
    const file = await writeProjectSettings(folder, next)
    this.settings = next
    this.set("editor:projectDialog", PROJECT_DIALOG_DEFAULT)
    void this.publishFiles()
    this.publishProject(`saved ${file}`)
    void this.publishRecent()
  }

  //=========================
  // Files changed outside
  //=========================

  /** Changes on disk from other programs, gathered for a moment, then: scripts rebuilt, prefabs rebuilt, the project file re-read. */
  private onDiskChange(paths: string[]): void {
    for (const path of paths) this.changedOnDisk.add(path)
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null
      const changed = [...this.changedOnDisk]
      this.changedOnDisk.clear()
      void this.applyDiskChanges(changed)
    }, 300)
  }

  private async applyDiskChanges(changed: string[]): Promise<void> {
    const folder = this.folder
    const root = this._root
    if (!folder || !root) return
    const scripts = changed.filter((path) => path.startsWith(`${SCRIPTS_DIR}/`))
    const prefabs = changed.filter((path) => path.startsWith(`${PREFABS_DIR}/`) && path.endsWith(".json"))
    const project = changed.some((path) => !path.includes("/") && (path.endsWith(PROJECT_EXTENSION) || path === LEGACY_PROJECT_FILE))
    const scene = changed.some((path) => this.recipe.files?.includes(path))
    if (scene && !this.hasUnsavedWork) {
      await this.reloadProject({ discarding: true })
      this.publishProject("reloaded from disk: the scene changed outside")
      return
    }
    if (scene) this.askAboutSceneOnDisk()
    await this.relinkAssets(folder)
    void this.publishFiles()
    await this.reloadUIFiles(changed)
    for (const path of changed.filter((path) => CODE_FILE.test(path))) {
      try {
        this.set("editor:codeFile", { path, text: await folder.readText(path), status: `reloaded ${path} from disk` })
      } catch {}
    }
    const notes: string[] = []
    if (scripts.length) {
      await this.reloadScripts()
      notes.push(`${scripts.length} script${scripts.length === 1 ? "" : "s"}`)
    }
    if (prefabs.length) {
      await this.loadPrefabs()
      for (const path of prefabs) await this.reloadInstances(path)
      notes.push(`${prefabs.length} prefab${prefabs.length === 1 ? "" : "s"}`)
    }
    if (project) {
      this.settings = await readProjectSettings(folder)
      void this.publishRecent()
      notes.push("the project file")
    }
    if (notes.length) this.publishProject(`changed on disk: ${notes.join(", ")}`)
    this.publishSelection()
  }

  /** The scene file changed outside while this session holds unsaved changes: the user picks which to keep. */
  private askAboutSceneOnDisk(): void {
    openConfirm("The scene changed on disk", "Another program saved the scene while you have unsaved changes here.\nKeep yours and the next save overwrites the disk, or reload and lose them.", [
      { label: "Keep my changes", run: () => this.publishProject("unsaved changes kept; File → Reload from disk takes the disk's") },
      { label: "Reload from disk", primary: true, run: () => void this.reloadProject({ discarding: true }) },
    ])
  }

  //=========================
  // Running
  //=========================

  /**
   * Play the project in the runner window: the scene as it is now, unsaved
   * edits included, and the folder for what it names. One named window is
   * reused, so a second run swaps the scene there rather than opening another.
   */
  async run(): Promise<void> {
    if (!this._root) return
    if (this.runner.isOpen && this.runnerReady) {
      void this.sendToRunner()
      this.runner.focus()
      return
    }
    this.runnerReady = false
    const url = new URL("play.html", location.href)
    url.searchParams.set("recipe", this.recipe.name)
    if (!this.runner.open(url.href)) return this.publishProject("the runner window could not be opened")
    this.set("editor:running", true)
  }

  private runErrorShown = false

  /** Lines from the run window's console, a repeat of the line before counted on it; the run's first error goes on the status line too. */
  private heardConsole(entries: ConsoleEntry[]): void {
    const lines = [...((this.app.shared("editor:console").value as ConsoleEntry[] | undefined) ?? [])]
    for (const entry of entries) {
      const last = lines[lines.length - 1]
      if (last && last.level === entry.level && last.text === entry.text && last.stack === entry.stack) lines[lines.length - 1] = { ...last, count: (last.count ?? 1) + 1, at: entry.at }
      else lines.push(entry)
    }
    this.set("editor:console", lines.slice(-CONSOLE_KEPT))
    const error = entries.find((entry) => entry.level === "error")
    if (error && !this.runErrorShown) {
      this.runErrorShown = true
      this.publishProject(`the run hit an error: ${error.text.split("\n")[0]} · see the Console pane`)
    }
  }

  private async sendToRunner(): Promise<void> {
    if (!this.runner.isOpen || !this._root) return
    this.set("editor:signalLog", [])
    this.set("editor:console", [])
    this.runErrorShown = false
    this.runner.send({ type: "catalyst:options", frequentSignals: Boolean(this.app.shared("editor:signalLogFrequent").value) })
    const folder = this.folder
    const sceneFile = this.sceneFile
    if (folder && sceneFile && this.recipe.files?.[0]) {
      // A file other than the project's scene is open: the game runs as saved, with that file as it is now.
      const scene = await folder.readJSON<NodeJSON>(this.recipe.files[0])
      const open = this.engine.serialise(this._root)
      if (!this.sceneFileHasTransform) delete open.transform
      const files = { [sceneFile]: await folder.toPaths(open) }
      this.runner.send({ type: "catalyst:run", recipe: this.recipe.name, scene, folder: folder.transfer(), files, launch: { open: sceneFile } })
    } else {
      const live = this.recipe.serialise?.(this._root, this.engine) ?? this.engine.serialise(this._root)
      const scene = folder ? await folder.toPaths(live) : live
      this.runner.send({ type: "catalyst:run", recipe: this.recipe.name, scene, folder: folder?.transfer() ?? null })
    }
    this.publishProject("running")
  }

  /**
   * Write the project as a static site to a folder the user picks (a zip
   * download where folders can't be picked): the player runtime, the
   * project's files and the scene as it is now, unsaved edits included.
   */
  async exportSite(): Promise<void> {
    const project = this.folder
    if (!this._root || !project) return this.publishProject("save the project before exporting it")
    const live = this.recipe.serialise?.(this._root, this.engine) ?? this.engine.serialise(this._root)
    const scene = await project.toPaths(live)
    let target: PublishTarget
    let zip: ZipTarget | null = null
    let place: string
    if (this.folders.isSupported) {
      const out = await this.folders.pick()
      if (!out) return
      if (await isWithin(out, project)) return this.publishProject("choose a folder outside the project to export into")
      if ((await out.list()).length > 0 && !(await confirmed(`Export into ${out.name}?`, "It isn't empty: files with the same names are replaced, the rest left as they are.", "Export"))) return
      target = out
      place = out.name
    } else {
      target = zip = new ZipTarget()
      place = "a zip"
    }
    let shown = 0
    try {
      const total = await publish({
        project,
        scene,
        sceneFile: this.recipe.files?.[0] ?? "scene.json",
        target,
        onProgress: (done, total) => {
          if (done !== total && performance.now() - shown < 100) return
          shown = performance.now()
          this.publishProject(`exporting ${done} of ${total} files`)
        },
      })
      if (zip) download(`${slug(this.settings?.name ?? project.name)}.zip`, zip.blob())
      this.publishProject(`exported ${total} files to ${place}`)
    } catch (error) {
      this.publishProject(`export failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private saveRequests = 0

  /** Save everything unsaved: the code pane's file (it answers the request with a `saveScript`), then the scene. */
  async saveAll(): Promise<void> {
    this.set("editor:saveRequest", ++this.saveRequests)
    if (this.folder) await this.save(this.folder)
    else await this.saveAs()
  }

  private async save(folder: ProjectFolder): Promise<void> {
    if (!this._root) return
    const written = await this.writeRoot(folder, this._root)
    void this.publishFiles()
    this.history.markSaved()
    this.publishProject(`saved ${written.join(", ")}`)
  }

  private async saveAs(): Promise<void> {
    if (!this.folders.isSupported) {
      const file = this._root && this.recipe.download?.(this._root, this.engine)
      if (file) download(file.name, file.text)
      return
    }
    const picked = await this.folders.pick()
    if (!picked) return
    if (!(await picked.ensurePermission())) return
    const folder = await AssetFolder.open(picked)
    this.folder = folder
    await folder.remember()
    void this.publishRecent()
    this.engine.loader = this.loaderFor(folder)
    this.useFolderScripts()
    await this.save(folder)
    await this.loadPrefabs()
    await this.loadScriptFiles()
  }

  //=========================
  // Scripts
  //=========================

  /** Scripts build from the project folder's files, or through the engine's default import when there is no folder. */
  private useFolderScripts(): void {
    this.compiler = this.folder ? new ScriptCompiler(this.folder) : null
    this.engine.scripts.invalidate()
    if (this.compiler) this.engine.scripts.loader = this.compiler.loader
  }

  private async loadScriptFiles(): Promise<void> {
    const files = this.folder ? await this.folder.list(SCRIPTS_DIR) : []
    this.scriptFiles = files.filter((file) => file.kind === "file" && /\.(ts|js)$/.test(file.name)).map((file) => ({ path: file.path, name: file.name.replace(/\.(ts|js)$/, "") }))
    this.set("editor:scripts", this.scriptFiles)
    void this.publishFiles()
  }

  private selectionScripts(node: Node3D): SelectionScript[] {
    const name = (url: string) => url.slice(url.lastIndexOf("/") + 1).replace(/\.(ts|js)$/, "")
    const built = node.scripts.map((script, index) => ({
      index,
      url: script.url,
      name: name(script.url),
      className: script.constructor.name,
      built: true,
      fields: exposedProperties(script).map((property) => ({ ...this.field(property, readExposed(script, property)), origin: declaredBy(script, "exposed", (entry: ExposedProperty) => entry.key === property.key) })),
    }))
    const pending = node.pendingScripts.map((json, i) => ({ index: node.scripts.length + i, url: json.url, name: name(json.url), built: false, fields: [] }))
    return [...built, ...pending]
  }

  /** Attach a script file to the selected node; its fields appear once it is built. */
  private async attachScript(url: string, node: Node3D | null = this.selected): Promise<void> {
    this.signalsShown.stale = true
    if (!node || node === this._root) return
    await node.addScript({ url })
    if (this.selected === node) this.publishSelection()
    const script = node.scripts.find((s) => s.url === url && !this.knownScripts.has(s))
    if (script) {
      this.knownScripts.add(script)
      const index = node.scripts.indexOf(script)
      this.record(`attach ${url}`, () => node.detachScript(script), () => node.attachScript(script, index))
    } else {
      const entry = node.pendingScripts.find((json) => json.url === url)
      if (entry) this.record(`attach ${url}`, () => (node.pendingScripts = node.pendingScripts.filter((j) => j !== entry)), () => node.pendingScripts.push(entry))
      this.publishProject(`${url} could not be built; see the console`)
    }
    this.publishSelection()
  }

  private readonly knownScripts = new WeakSet<Script>()

  private detachScript(index: number): void {
    this.signalsShown.stale = true
    const node = this.selected
    if (!node) return
    if (this._root && this.variants.isInheritedScript(node, index, this._root)) return this.publishProject(`the script comes from ${this.variants.base}: detach it there`)
    if (index < node.scripts.length) {
      const script = node.scripts[index]
      node.detachScript(script)
      this.record(`detach ${script.url}`, () => node.attachScript(script, index), () => node.detachScript(script))
    } else {
      const entry = node.pendingScripts[index - node.scripts.length]
      if (!entry) return
      const drop = () => (node.pendingScripts = node.pendingScripts.filter((j) => j !== entry))
      drop()
      this.record(`detach ${entry.url}`, () => node.pendingScripts.push(entry), drop)
    }
    this.publishSelection()
  }

  /** A field of the script from `url` on `node`, set and recorded like an inspector edit. */
  private setScriptField(node: Node3D, url: string, key: string, value: unknown): void {
    const index = node.scripts.findIndex((script) => script.url === url)
    const script = node.scripts[index]
    const property = script ? exposedProperties(script).find((p) => p.key === key) : undefined
    if (!script || !property) return
    const before = readExposed(script, property)
    writeExposed(script, property, value)
    this.record(property.label ?? key, () => writeExposed(script, property, before), () => writeExposed(script, property, value), `script:${this.idOf(node)}:${index}:${key}`)
    this.signalsShown.stale = true
    if (this.selected === node) this.publishSelection()
  }

  private writeScriptProperty(index: number, key: string, value: unknown): void {
    const node = this.selected
    const script = node?.scripts[index]
    if (!node || !script) return
    const property = exposedProperties(script).find((p) => p.key === key)
    if (!property || property.readonly) return
    const before = readExposed(script, property)
    const next = this.coerce(property, value, before)
    if (next === undefined) return
    if (JSON.stringify(before) === JSON.stringify(next)) return
    writeExposed(script, property, next)
    this.record(property.label ?? key, () => writeExposed(script, property, before), () => writeExposed(script, property, next), `script:${this.idOf(node)}:${index}:${key}`)
    if (property.type === "node") this.signalsShown.stale = true
    this.publishSelection()
  }

  /** Write a starting script named after the class into scripts/, and attach it to the selected node. */
  private async importDropped(files: File[], dir = ASSETS_DIR): Promise<void> {
    const folder = this.folder
    if (!folder) return this.publishProject("the project needs a folder before files can be imported")
    const paths: string[] = []
    for (const file of files) paths.push(await folder.importFile(file, dir))
    if (paths.length) this.publishProject(paths.length === 1 ? `imported ${paths[0]}` : `imported ${paths.length} files into ${dir || "the project"}`)
    await this.publishFiles()
  }

  private async renameFile(from: string, to: string): Promise<void> {
    const folder = this.folder
    if (!folder || from === to) return
    if (!/^[^/\\:*?"<>|]+(\/[^/\\:*?"<>|]+)*$/.test(to) || to.split("/").some((part) => part === "." || part === "..")) return this.publishProject(`“${to}” is not a name a file can have`)
    if (await folder.exists(to)) return this.publishProject(`${to} already exists`)
    try {
      await folder.rename(from, to)
    } catch (error) {
      return this.publishProject(`${from} could not be renamed: ${error instanceof Error ? error.message : error}`)
    }
    this.publishProject(`renamed ${from} to ${to}`)
    this.retarget(from, to)
    this.set("editor:codeFile", { path: from, to, status: "" })
    await this.loadScriptFiles()
    await this.loadPrefabs()
  }

  /**
   * Point everything in the open scene that names `from` (or a file under
   * it, when it is a folder) at `to`: node and script fields, script files
   * and the recipe's settings. Not an edit: the saved scene names the file
   * by id, so it does not change.
   */
  private retarget(from: string, to: string): void {
    const root = this._root
    if (!root) return
    const moved = (value: unknown): string | null => (typeof value === "string" && (value === from || value.startsWith(`${from}/`)) ? to + value.slice(from.length) : null)
    const retargetFields = (target: object) => {
      for (const property of exposedProperties(target)) {
        if (property.type !== "string" && property.type !== "file") continue
        const next = moved(readExposed(target, property))
        if (next !== null && !property.readonly) writeExposed(target, property, next)
      }
    }
    root.walk((node) => {
      retargetFields(node)
      for (const script of node.scripts) {
        const url = moved(script.url)
        if (url !== null) script.url = url
        retargetFields(script)
      }
      for (const json of node.pendingScripts) {
        const url = moved(json.url)
        if (url !== null) json.url = url
      }
    })
    const image = moved(this.settings?.image)
    if (this.settings && image !== null) this.settings = { ...this.settings, image }
    const settings = this.recipe.settings
    if (settings) {
      const values = settings.read(this.engine, root)
      for (const field of settings.fields) {
        const next = field.type === "file" ? moved(values[field.key]) : null
        if (next !== null) settings.write(this.engine, root, field.key, next)
      }
      this.publishSettings()
    }
    this.publishSelection()
  }

  /** Files the scene names that moved outside the editor, found again and pointed at; any still missing are named. */
  private async relinkAssets(folder: AssetFolder): Promise<void> {
    const relinked = await folder.relink().catch(() => [])
    for (const { from, to } of relinked) this.retarget(from, to)
    if (relinked.length) void this.publishFiles()
    const missing = await folder.missing().catch(() => [])
    const notes = [...relinked.map(({ from, to }) => `found ${from} at ${to}`), ...(missing.length ? [`missing: ${missing.join(", ")}`] : [])]
    if (notes.length) this.publishProject(notes.join("; "))
  }

  /** Deleting asks first; the scene is not touched, so a node pointing at the file keeps its url. */
  private deleteFile(path: string): void {
    const folder = this.folder
    if (!folder) return
    openConfirm(`Delete ${path}?`, "It is removed from the project folder. Nodes and settings that name it keep the name.", [
      { label: "Cancel", run: () => undefined, primary: true },
      {
        label: "Delete",
        run: () => {
          void folder
            .remove(path)
            .then(() => {
              this.publishProject(`deleted ${path}`)
              this.set("editor:codeFile", { path, gone: true, status: "" })
              this.set("editor:fileInfo", null)
              return this.loadScriptFiles()
            })
            .catch((error) => this.publishProject(`${path} could not be deleted: ${error instanceof Error ? error.message : error}`))
        },
      },
    ])
  }

  private async newFolder(path: string): Promise<void> {
    const folder = this.folder
    if (!folder) return
    if (!/^[^/\\:*?"<>|]+(\/[^/\\:*?"<>|]+)*$/.test(path)) return this.publishProject(`“${path}” is not a name a folder can have`)
    await folder.mkdir(path)
    this.publishProject(`made ${path}/`)
    await this.publishFiles()
  }

  /** The selected file's size and date, and a preview when it is an image of a sensible size. */
  private async publishFileInfo(path: string | null): Promise<void> {
    const folder = this.folder
    if (!folder || !path) return this.set("editor:fileInfo", null)
    if (THECA.test(path)) return this.publishThecaInfo(path)
    try {
      const info = await folder.stat(path)
      let preview: string | null = null
      if (/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(path) && info.size <= PREVIEW_BYTES) preview = await this.dataUrl(path)
      const facts = fileFacts(info.size, info.modified)
      this.set("editor:fileInfo", { path, size: info.size, modified: info.modified, preview, facts })
      // A model or an environment is drawn while its facts already show; the picture lands if the file is still the one chosen.
      const still = () => (this.app.shared("editor:fileInfo").value as EditorCells["editor:fileInfo"])?.path === path && this.folder === folder
      if (/\.(glb|gltf)$/i.test(path)) {
        const drawn = await this.previews.model(folderLoader(folder), path, info.modified)
        if (drawn && still()) this.set("editor:fileInfo", { path, size: info.size, modified: info.modified, preview: drawn.image, facts: `${drawn.meshes === 1 ? "1 mesh" : `${drawn.meshes} meshes`} · ${drawn.triangles.toLocaleString()} triangles · ${facts}` })
      } else if (/\.hdr$/i.test(path)) {
        const drawn = await this.previews.environment(folderLoader(folder), path, info.modified)
        if (drawn && still()) this.set("editor:fileInfo", { path, size: info.size, modified: info.modified, preview: drawn, facts })
      }
    } catch {
      this.set("editor:fileInfo", null)
    }
  }

  private async dataUrl(path: string): Promise<string> {
    const file = await this.folder!.readFile(path)
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
  }

  /** A theca's facts from its manifest: what it holds and what made it, and its thumbnail. */
  private async publishThecaInfo(path: string): Promise<void> {
    const m = await this.readTheca(path)
    if (!m) return this.set("editor:fileInfo", { path, size: 0, modified: 0, preview: null, facts: `no ${THECA_MANIFEST}: not a built theca` })
    const bytes = (m.hierarchy?.bytes ?? 0) + (m.maps ?? []).reduce((n, map) => n + (map.bytes ?? 0), 0)
    const megabytes = bytes ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : ""
    const geometry = m.triangles ? `${m.triangles.toLocaleString()} triangles${m.hierarchy?.levels ? ` in ${m.hierarchy.levels} levels` : ""}` : "no geometry"
    const maps = m.maps?.length ? m.maps.map((map) => `${MAP_NAMES[map.role] ?? map.role} ${map.size}`).join(", ") : "no maps"
    const source = m.source?.path ? `from ${m.source.path.replace(/^.*\//, "")}${m.source.meshName ? ` (${m.source.meshName})` : ""}` : ""
    const facts = [geometry, maps, megabytes, source, ...(m.warnings ?? [])].filter(Boolean).join(" · ")
    const preview = m.thumbnail ? await this.dataUrl(`${path}/${m.thumbnail}`).catch(() => null) : null
    this.set("editor:fileInfo", { path, size: bytes, modified: 0, preview, facts })
  }

  /** Change a script file with `edit`, refused while the code pane holds unsaved changes to it, and rebuild the scripts from it. */
  private async editScript(url: string, edit: (source: string) => string | null): Promise<void> {
    const folder = this.folder
    if (!folder) throw new Error("the project needs a folder before scripts can be written")
    if (this.unsavedCode.some((file) => file.path === url)) throw new Error(`${url} has unsaved changes in the code pane: save or close it first`)
    const text = await folder.readText(url)
    const next = edit(text)
    if (next === null) throw new Error(`${url} declares its connections or signals in a way the editor can't change; edit it in the code pane`)
    if (next !== text) await this.saveScript(url, next)
  }

  /** Every prefab file in the project, read as a scene entry; one that can't be read is left out. */
  private async prefabFiles(): Promise<{ path: string; json: NodeJSON }[]> {
    const folder = this.folder
    if (!folder) return []
    const out: { path: string; json: NodeJSON }[] = []
    for (const { path } of this.prefabs) {
      try {
        out.push({ path, json: await folder.readJSON<NodeJSON>(path) })
      } catch {}
    }
    return out
  }

  /** A script of its own for a node, named after it, attached to it. */
  private async newScriptFor(node: Node3D): Promise<string | null> {
    const folder = this.folder
    if (!folder) return null
    const className = node.name.replace(/[^\w$]+(.)?/g, (_, next: string | undefined) => (next ?? "").toUpperCase()).replace(/^[^A-Za-z_$]+/, "") || "NodeScript"
    const base = `${SCRIPTS_DIR}/${slug(className)}`
    let path = `${base}.ts`
    for (let n = 2; await folder.exists(path); n++) path = `${base}-${n}.ts`
    await folder.writeText(path, plainScriptTemplate(className.charAt(0).toUpperCase() + className.slice(1)))
    await this.loadScriptFiles()
    await this.attachScript(path, node)
    return path
  }

  private async newScript(name: string, attach = true): Promise<void> {
    const folder = this.folder
    if (!folder) return this.publishProject("the project needs a folder before scripts can be written")
    const className = name.trim().replace(/[^\w$]+/g, "").replace(/^[0-9]+/, "")
    if (!className) return
    const path = `${SCRIPTS_DIR}/${slug(className)}.ts`
    if (!(await folder.exists(path))) await folder.writeText(path, scriptTemplate(className.charAt(0).toUpperCase() + className.slice(1)))
    await this.loadScriptFiles()
    this.publishProject(`saved ${path}`)
    if (attach && this.selected && this.selected !== this._root) await this.attachScript(path)
  }

  /** Put a script file's text in the code pane. */
  /** The folder's files as a tree, hidden folders and dotfiles left out, folders first. */
  private async publishFiles(): Promise<void> {
    const folder = this.folder
    if (!folder) return this.set("editor:files", [])
    const generation = ++this.filesGeneration
    const read = async (dir: string): Promise<FileTree[]> => {
      const entries = (await folder.list(dir)).filter((entry) => !entry.name.startsWith(".") && !HIDDEN_DIRS.has(entry.name))
      const out: FileTree[] = []
      for (const entry of entries) out.push(entry.kind === "directory" ? { ...entry, children: await read(entry.path) } : { ...entry })
      return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1))
    }
    const tree = await read("")
    if (generation !== this.filesGeneration || this.folder !== folder) return
    this.set("editor:files", tree)
    const files: string[] = []
    const gather = (entries: FileTree[]) => {
      for (const entry of entries) entry.kind === "directory" && !THECA.test(entry.name) ? gather(entry.children ?? []) : files.push(entry.path)
    }
    gather(tree)
    if (files.join("\n") === this.projectFiles.join("\n")) return
    this.projectFiles = files.sort()
    this.set("editor:codeFiles", this.projectFiles.filter((path) => CODE_FILE.test(path)))
    this.publishSettings()
    this.publishSelection()
  }

  /** Choose a file and copy it into the project, under `dir` (assets by default). */
  private async importAsset(dir = ASSETS_DIR): Promise<void> {
    const folder = this.folder
    if (!folder) return this.publishProject("the project needs a folder before files can be imported")
    const file = await pickFile("")
    if (!file) return
    const path = await folder.importFile(file, dir)
    this.publishProject(`imported ${path}`)
    await this.publishFiles()
  }

  /** Tabs the code pane had open, read again in their order, then `active` brought forward; files gone since are left out. */
  private async openScripts(paths: string[], active: string | null): Promise<void> {
    const folder = this.folder
    if (!folder) return
    const present: string[] = []
    for (const path of paths) if (await folder.exists(path).catch(() => false)) present.push(path)
    if (active && present.includes(active)) present.push(active)
    for (const path of present) if (this.folder === folder) await this.openScript(path)
  }

  private async openScript(path: string): Promise<void> {
    const folder = this.folder
    if (!folder) return
    try {
      this.set("editor:code", { path, text: await folder.readText(path), status: "" })
    } catch {
      this.publishProject(`${path} could not be read`)
    }
  }

  /**
   * The engine reads the project through this: the folder, but a component or stylesheet the code
   * pane is editing reads as its unsaved text, so the viewport shows it before it is saved.
   */
  private loaderFor(folder: ProjectFolder) {
    const base = folderLoader(folder)
    return {
      ...base,
      text: (url: string) => (this.drafts.has(url) ? Promise.resolve(this.drafts.get(url)!) : base.text(url)),
    }
  }

  /** Show a component or stylesheet's unsaved text in the viewport, and say whether it compiled. */
  private async draftFile(path: string, text: string): Promise<void> {
    if (!PREVIEWED_CODE.test(path)) return
    this.drafts.set(path, text)
    this.followInPreview(path, text)
    const status = await this.reloadAndReport(path, "previewing")
    this.set("editor:codeFile", { path, status })
  }

  /** Reload what reads a file and give back the first component's error, or `ok` with the file named. */
  private async reloadAndReport(path: string, ok: string): Promise<string> {
    await this.reloadUIFiles([path])
    let error: string | null = null
    let readers = 0
    this._root?.walk((node) => {
      const reader = node as Node3D & { files?: string[]; error?: string | null }
      if (!reader.files?.includes(path)) return
      readers++
      error ??= reader.error ?? null
    })
    if (error) return error
    const preview = this.app.shared("editor:preview").value as EditorCells["editor:preview"]
    const previewed = preview?.open && preview.kind === "component" && (preview.path === path || preview.stylesheet === path)
    return readers || previewed ? `${ok} ${path}` : `${ok} ${path} · nothing in the scene uses it`
  }

  /** A closed tab's unsaved text back to what is on disk, and what showed it reloaded. */
  private async discardDraft(path: string): Promise<void> {
    if (!this.drafts.delete(path)) return
    this.followInPreview(path, await this.readDraftOrFile(path))
    await this.reloadUIFiles([path])
  }

  /** Write a file from the code pane: a script rebuilds every script, reporting a build error against the file; a component or stylesheet reloads what shows it. */
  private async saveScript(path: string, text: string): Promise<void> {
    const folder = this.folder
    if (!folder) return
    await folder.writeText(path, text)
    this.drafts.delete(path)
    if (PREVIEWED_CODE.test(path)) {
      this.followInPreview(path, text)
      const status = await this.reloadAndReport(path, "saved")
      await this.publishFiles()
      return this.set("editor:codeFile", { path, text, status })
    }
    await this.reloadUIFiles([path])
    await this.reloadScripts()
    this.compiler?.invalidate(path)
    this.engine.scripts.invalidate(path)
    let status = `saved ${path}`
    try {
      await this.engine.scripts.load(path)
    } catch (error) {
      status = error instanceof Error ? error.message : String(error)
    }
    this.set("editor:codeFile", { path, text, status })
  }

  /** Slates and UI nodes reading any of these files read them again. */
  private async reloadUIFiles(paths: string[]): Promise<void> {
    const changed = new Set(paths)
    const reloads: Promise<void>[] = []
    this._root?.walk((node) => {
      const reader = node as Node3D & { files?: string[]; reload?: () => Promise<void> }
      if ((node instanceof Slate || node instanceof UIElement) && reader.reload && reader.files?.some((file) => changed.has(file))) reloads.push(reader.reload())
    })
    await Promise.all(reloads)
  }

  /** Read every script file again and rebuild the scripts on every node, keeping their values. */
  private async reloadScripts(): Promise<void> {
    const root = this._root
    if (!root) return
    this.compiler?.invalidate()
    const urls = new Set<string>()
    root.walk((node) => {
      for (const script of node.scripts) urls.add(script.url)
      for (const json of node.pendingScripts) urls.add(json.url)
    })
    await Promise.all([...urls].map((url) => this.engine.scripts.reload(url, root)))
    this.signalsShown.stale = true
    await this.loadScriptFiles()
    this.publishProject(urls.size ? `rebuilt ${urls.size} script${urls.size === 1 ? "" : "s"}` : "no scripts in the scene")
    this.publishSelection()
  }

  //=========================
  // Prefabs
  //=========================

  /** The prefab files in the project, offered as kinds to add. */
  private async loadPrefabs(): Promise<void> {
    const folder = this.folder
    const found: { path: string; name: string }[] = []
    const visit = async (dir: string): Promise<void> => {
      for (const entry of folder ? await folder.list(dir) : []) {
        if (entry.kind === "directory") await visit(entry.path)
        else if (entry.name.endsWith(".json")) found.push({ path: entry.path, name: entry.path.slice(PREFABS_DIR.length + 1, -5) })
      }
    }
    await visit(PREFABS_DIR)
    this.prefabs = found
    this.publishKinds()
  }

  /** A new file made from the node-tree file at `path`, changing nothing yet, beside it; opened to edit. */
  private async newVariant(path: string): Promise<void> {
    const folder = this.folder
    if (!folder) return
    const json = await folder.readJSON<{ type?: unknown }>(path).catch(() => null)
    if (typeof json?.type !== "string" && !isVariant(json)) return this.publishProject(`${path} isn't a node tree to make a variant of`)
    const stem = path.replace(/\.json$/i, "")
    let made = `${stem}-variant.json`
    for (let n = 2; await folder.exists(made); n++) made = `${stem}-variant-${n}.json`
    await folder.writeJSON(made, { base: path } satisfies VariantJSON)
    await this.publishFiles()
    await this.openScene(made)
  }

  private resetOverride(key: string, scriptIndex?: number): void {
    const node = this.selected
    const root = this._root
    if (!node || !root) return
    const base = this.variants.baseNode(node, root)
    if (!base) return
    if (scriptIndex !== undefined) {
      const script = node.scripts[scriptIndex]
      const property = script && exposedProperties(script).find((p) => p.key === key)
      const given = property && this.variants.baseScriptValue(node, scriptIndex, property, root)
      if (!script || !property || !given) return
      const before = structuredClone(readExposed(script, property))
      writeExposed(script, property, given.value)
      this.record(`reset ${property.label ?? key}`, () => writeExposed(script, property, before), () => writeExposed(script, property, structuredClone(given.value)))
    } else if (key === "transform") {
      if (!(base instanceof Node3D)) return
      const before = { position: node.transform.position.clone(), rotation: node.transform.rotation.clone(), scale: node.transform.scale.clone() }
      const after = { position: base.transform.position.clone(), rotation: base.transform.rotation.clone(), scale: base.transform.scale.clone() }
      const place = (to: typeof before) => () => {
        node.transform.position.copy(to.position)
        node.transform.rotation.copy(to.rotation)
        node.transform.scale.copy(to.scale)
        this.camera.syncFromTarget()
      }
      place(after)()
      this.record("reset transform", place(before), place(after))
    } else {
      const property = exposedProperties(node).find((p) => p.key === key)
      if (!property) return
      const before = structuredClone(readExposed(node, property))
      const after = structuredClone(readExposed(base, property))
      writeExposed(node, property, after)
      this.record(`reset ${property.label ?? key}`, () => writeExposed(node, property, before), () => writeExposed(node, property, structuredClone(after)))
      if (key === "active" || key === "visible") this.publishTree()
    }
    this.grids.publish()
    this.publishSelection()
  }

  /**
   * Save the selected node's tree as a prefab file named after it, and put
   * an instance of the file in its place. Saving over a prefab of the same
   * name updates every instance of it in the scene.
   */
  private async makePrefab(): Promise<void> {
    const node = this.selected
    const folder = this.folder
    const root = this._root
    if (!node || !root || node === root || this.selection.size > 1) return
    if (!folder) return this.publishProject("the project needs a folder before prefabs can be saved")
    if (node instanceof Prefab) return this.publishProject(`${node.name} is already a prefab instance`)
    const path = `${PREFABS_DIR}/${slug(node.name)}.json`
    const { transform: _transform, ...json } = this.engine.serialise(node)
    await folder.writeJSON(path, json)
    this.engine.prefabs.invalidate(path)
    void this.publishFiles()
    const parent = node.parent as Node3D
    const index = parent.indexOf(node)
    const instance = new Prefab({ name: node.name, url: path, visualise: this.visualised })
    instance.transform.position.copy(node.transform.position)
    instance.transform.rotation.copy(node.transform.rotation)
    instance.transform.scale.copy(node.transform.scale)
    const swapIn = () => {
      node.remove()
      parent.insertNode(instance, index, instance.name)
    }
    const swapOut = () => {
      instance.remove()
      parent.insertNode(node, index, node.name)
    }
    swapIn()
    this.record(`make prefab ${node.name}`, swapOut, swapIn)
    await this.reloadInstances(path, instance)
    await this.loadPrefabs()
    this.publishProject(`saved ${path}`)
    this.select(instance)
  }

  /** Replace the selected prefab instance with an editable copy of its file's tree, at the same place and pose. */
  private async unpackPrefab(): Promise<void> {
    const instance = this.selected
    const root = this._root
    if (!(instance instanceof Prefab) || !root || this.selection.size > 1) return
    let json: NodeJSON
    try {
      json = await this.engine.loader.json<NodeJSON>(instance.url)
    } catch {
      return this.publishProject(`${instance.url} could not be read`)
    }
    if (this.selected !== instance) return
    const made = this.engine.create({ ...json, name: instance.name })
    if (!(made instanceof Node3D)) return this.publishProject(`${instance.url} is not a spatial node`)
    const parent = instance.parent as Node3D
    const index = parent.indexOf(instance)
    const name = instance.name
    const world = new Mat4().multiply(instance.transform.worldMatrix, made.transform.matrix)
    const unpack = () => {
      instance.remove()
      parent.insertNode(made, index, name)
      made.transform.setWorldMatrix(world)
    }
    const pack = () => {
      made.remove()
      parent.insertNode(instance, index, name)
    }
    unpack()
    if (this.visualised) made.walk((child) => {
      if (child instanceof Node3D) child.visualised = true
    })
    this.record(`unpack ${name}`, pack, unpack)
    this.select(made)
  }

  /** After a prefab file is written: every instance of it in the scene follows, read again once for all of them. */
  private async reloadInstances(path: string, except?: Prefab): Promise<void> {
    if (!except) this.engine.prefabs.invalidate(path)
    const reloads: Promise<void>[] = []
    this._root?.walk((node) => {
      if (node instanceof Prefab && node !== except && node.url === path) reloads.push(node.reload())
    })
    await Promise.all(reloads)
  }

  //=========================
  // View
  //=========================

  private setGizmo(mode: GizmoMode): void {
    this.gizmo = mode
    this.camera.mode = mode
    // A gizmo key leaves the draw tool.
    this.camera.tool = null
    this.camera.paintTarget = null
    this.grids.publish()
    this.publishView()
  }

  /** The draw tools stay on between boxes; pressing the same tool's key again, or a gizmo key, leaves them. */
  private setTool(tool: DrawTool | null): void {
    this.camera.tool = this.camera.tool === tool ? null : tool
    if (this.camera.tool) this.camera.paintTarget = null
    this.grids.publish()
    this.publishView()
  }

  /** The box the draw tool finished: a block with a collider, or a collider volume alone, under the selected node or the root. */
  private async addDrawnBox(box: DrawnBox): Promise<void> {
    const kind = box.kind === "collider" ? "BoxCollider" : "Box"
    // Drawn in world space, so it goes at the root rather than under whatever is selected.
    await this.addNode(kind, { width: round(box.size.x), height: round(box.size.y), depth: round(box.size.z) }, box.centre, this._root ?? undefined)
  }

  /** A box collider child fitted to the selected node's meshes, for a model that has no collision of its own. */
  private addBoundsCollider(): void {
    const node = this.selected
    if (!node || node === this._root) return
    const inverse = new Mat4().invert(node.transform.worldMatrix)
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)
    const corner = new Vector3()
    node.walk((child) => {
      if (!(child instanceof Node3D)) return
      for (const visual of child.attachedObjects) {
        if (visual.isLines) continue
        const b = (visual.geometry as { bounds?: { min: Vector3; max: Vector3 } }).bounds
        if (!b) continue
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
          visual.matrix.transformPoint(corner, corner)
          inverse.transformPoint(corner, corner)
          min.set(Math.min(min.x, corner.x), Math.min(min.y, corner.y), Math.min(min.z, corner.z))
          max.set(Math.max(max.x, corner.x), Math.max(max.y, corner.y), Math.max(max.z, corner.z))
        }
      }
    })
    if (!Number.isFinite(min.x)) return this.publishProject(`${node.name} has no mesh to fit a collider to`)
    const collider = new BoxCollider({ name: "collider", width: round(max.x - min.x), height: round(max.y - min.y), depth: round(max.z - min.z), visualise: this.visualised })
    collider.transform.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2)
    node.addNode(collider)
    if (this.visualised) collider.visualised = true
    this.collapsed.delete(node)
    const index = node.indexOf(collider)
    this.record("add collider from bounds", () => collider.remove(), () => node.insertNode(collider, index, collider.name))
    this.select(collider)
  }

  private setView(view: ViewMode): void {
    this.view = view
    this.camera.activate()
    this.input?.activate()
    if (this.selected) this.attachGizmo(this.selected)
    this.publishView()
  }

  /** Snapping as set, or the opposite while shift is held. */
  private applySnap(): void {
    const on = this.snap.enabled !== this.snapInverted
    this.camera.setSnap(on ? this.snap.move : null, on ? this.snap.rotate : null)
  }

  private setSnapInverted(inverted: boolean): void {
    if (this.snapInverted === inverted) return
    this.snapInverted = inverted
    this.applySnap()
  }

  private setVisualised(on: boolean): void {
    this.visualised = on
    this._root?.walk((node) => {
      if (node instanceof Node3D) node.visualised = on
    })
    this.publishView()
  }

  //=========================
  // Selection
  //=========================

  private select(node: Node3D | null, mode: SelectMode = "replace"): void {
    const root = this._root
    if (node === root && mode !== "replace") return
    if (!node) {
      this.selection.clear()
      this.anchor = null
    } else if (mode === "toggle") {
      if (this.selection.has(node)) {
        this.selection.delete(node)
        node = [...this.selection].pop() ?? null
      } else {
        if (root) this.selection.delete(root)
        this.selection.add(node)
      }
      this.anchor = node
    } else if (mode === "range" && this.anchor) {
      const visible = this.visibleNodes().map((row) => row.node)
      const from = visible.indexOf(this.anchor)
      const to = visible.indexOf(node)
      if (from >= 0 && to >= 0) this.selection = new Set(visible.slice(Math.min(from, to), Math.max(from, to) + 1).filter((n) => n !== root))
      else {
        this.selection = new Set([node])
        this.anchor = node
      }
    } else {
      this.selection = new Set([node])
      this.anchor = node
    }
    this.selected = node
    if (node && node !== root) this.attachGizmo(node)
    else this.camera.detach()
    this.publishSelectedRows()
    this.publishSelection()
  }

  /** A marquee's catch replaces the selection, or joins it when asked; the last one caught becomes the active node. */
  private selectMany(nodes: Node3D[], add: boolean): void {
    if (!add) this.selection.clear()
    for (const node of nodes) if (node !== this._root) this.selection.add(node)
    const node = nodes[nodes.length - 1] ?? [...this.selection].pop() ?? null
    this.selected = node
    this.anchor = node
    if (node) this.attachGizmo(node)
    else this.camera.detach()
    this.publishSelectedRows()
    this.publishSelection()
  }

  /** Selected nodes with no selected ancestor: moving or deleting these covers the whole selection. */
  private selectionRoots(): Node3D[] {
    const all = [...this.selection]
    return all.filter((node) => node !== this._root && !all.some((other) => other !== node && other.contains(node)))
  }

  private attachGizmo(node: Node3D): void {
    if (!this.camera.isActive) return
    const changed = () => this.publishSelection()
    const roots = this.selectionRoots().filter(isSpatial)
    if (this.selection.size > 1 && roots.length) this.camera.attachTarget(groupTarget(roots, isSpatial(node) ? node : roots[roots.length - 1]), changed)
    else if (isSpatial(node)) this.camera.attach(node, changed)
    else this.camera.detach()
  }

  private focusSelected(): void {
    if (!this.selected || !this.camera.isActive || !isSpatial(this.selected)) return
    // In the vertex tool, F looks at the picked vertices, edges or faces: their average, from a distance that shows their spread.
    const elements = this.camera.vertexEdit ? this.camera.elementFocus() : null
    if (elements) return this.camera.focusPoint(elements.centre, elements.distance)
    if (this.selection.size <= 1) return this.camera.focus(this.selected)
    const centre = new Vector3()
    for (const node of this.selection) centre.addVector(node.transform.getWorldPosition())
    this.camera.focusPoint(centre.scale(1 / this.selection.size))
  }

  //=========================
  // Editing
  //=========================

  private writeTransform(position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }): void {
    const node = this.selected
    if (!node) return
    const before = { position: node.transform.position.clone(), rotation: node.transform.rotation.clone() }
    const after = { position: new Vector3(position.x, position.y, position.z), rotation: new Quaternion().setFromEuler(radians(rotation.x), radians(rotation.y), radians(rotation.z), "YXZ") }
    if (before.position.equals(after.position) && before.rotation.equals(after.rotation)) return
    const apply = (state: typeof before) => () => {
      node.transform.position.copy(state.position)
      node.transform.rotation.copy(state.rotation)
    }
    apply(after)()
    this.record("transform", apply(before), apply(after), `transform:${this.idOf(node)}`)
    this.camera.syncFromTarget()
    this.publishSelection()
  }

  private renameSelected(name: string): void {
    const node = this.selected
    const clean = name.trim()
    if (!node || !clean || clean === node.name) return
    if (node !== this._root && this.inheritedAmong([node], "renamed")) return this.publishSelection()
    const before = node.name
    const references = this.wiring.referencesTo([node])
    const fields = this.wiring.nodeReferences()
    if (!node.rename(clean)) {
      this.publishProject(`"${clean}" already exists under ${node.parent?.name}`)
      this.publishSelection()
      return
    }
    // Connections that hear the node are written by name, so they follow it, both ways through undo.
    const follow = () => {
      this.wiring.repoint(fields)
      if (references.length) void this.wiring.retarget(references).catch((error: unknown) => this.publishProject(error instanceof Error ? error.message : String(error)))
    }
    follow()
    this.record(
      "rename",
      () => {
        node.rename(before)
        follow()
      },
      () => {
        node.rename(clean)
        follow()
      },
    )
    this.publishTree()
    this.publishSelection()
  }

  private writeProperty(key: string, value: unknown): void {
    const node = this.selected
    if (!node) return
    const property = exposedProperties(node).find((p) => p.key === key)
    if (!property || property.readonly) return
    const before = readExposed(node, property)
    const next = this.coerce(property, value, before)
    if (next === undefined) return
    if (JSON.stringify(before) === JSON.stringify(next)) return
    const after = Array.isArray(next) ? [...next] : next
    const previous = Array.isArray(before) ? [...before] : before
    if (node instanceof Grid && (key === "columns" || key === "rows")) {
      this.grids.change(property.label ?? key, node, () => writeExposed(node, property, after), `property:${this.idOf(node)}:${key}`)
      this.publishSelection()
      return
    }
    const write = (value: unknown) => {
      const wasSpatial = isSpatial(node)
      writeExposed(node, property, value)
      if (isSpatial(node) !== wasSpatial && this.selected === node) this.attachGizmo(node)
    }
    write(after)
    this.record(property.label ?? key, () => write(previous), () => write(after), `property:${this.idOf(node)}:${key}`)
    this.publishSelection()
    if (key === "active" || key === "visible") this.publishTree()
  }

  /**
   * A `file` field of the selected node, one of its scripts (by index) or
   * the recipe's settings: choose a file from disk, import it into the
   * project's assets and point the field at it.
   */
  private async pickFileFor(key: string, owner?: number | "setting"): Promise<void> {
    const target = owner === "setting" ? null : owner === undefined ? this.selected : this.selected?.scripts[owner]
    const field = owner === "setting" ? this.recipe.settings?.fields.find((f) => f.key === key) : target ? exposedProperties(target).find((p) => p.key === key) : undefined
    if (!field || field.type !== "file") return
    const file = await pickFile(field.accept ?? "")
    if (!file || !this.folder) return
    const path = await this.folder.importFile(file, ASSETS_DIR)
    await this.publishFiles()
    if (owner === "setting") this.writeSetting(key, path)
    else if (owner === undefined) this.writeProperty(key, path)
    else this.writeScriptProperty(owner, key, path)
  }

  private writeSetting(key: string, value: unknown): void {
    const settings = this.recipe.settings
    const root = this._root
    if (!settings || !root) return
    const field = settings.fields.find((f) => f.key === key)
    if (!field || field.readonly) return
    const next = this.coerce(field, value)
    if (next === undefined) return
    const before = settings.read(this.engine, root)
    if (JSON.stringify(before[key]) === JSON.stringify(next)) return
    settings.write(this.engine, root, key, next)
    const after = settings.read(this.engine, root)
    const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]))
    const restore = (values: Record<string, unknown>) => () => {
      for (const k of changed) settings.write(this.engine, root, k, values[k])
      this.publishSettings()
    }
    this.record(field.label ?? key, restore(before), restore(after), `setting:${key}`)
    this.publishSettings()
  }

  /** A value from the panel in the property's type, or undefined when it is not one. */
  private coerce(property: ExposedProperty, value: unknown, current?: unknown): unknown {
    if (property.type === "number") {
      let n = Number(value)
      if (!Number.isFinite(n)) return undefined
      if (property.min !== undefined) n = Math.max(property.min, n)
      if (property.max !== undefined) n = Math.min(property.max, n)
      return n
    }
    if (property.type === "boolean") return Boolean(value)
    if (property.type === "colour") {
      const n = typeof value === "string" ? parseInt(value.replace("#", ""), 16) : Number(value)
      return Number.isFinite(n) ? n : undefined
    }
    if (property.type === "tags") return [...new Set(toStrings(value).map((tag) => tag.trim()).filter(Boolean))]
    if (property.type === "select") return typeof value === "string" && (property.options ?? []).includes(value) ? value : undefined
    if (property.type === "file") return value === null || value === "" ? (typeof current === "string" ? "" : null) : String(value)
    if (property.type === "layers") return [...new Set(toStrings(value).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 32))].sort((a, b) => a - b)
    return String(value)
  }

  private toggleScripts(): void {
    this.engine.scripts.setRunning(!this.engine.scripts.running, this.engine.root, this.engine)
    this.publishView()
  }

  /** New nodes go under the selected node (or the root), at the orbit target in world space. A kind that needs a file asks for it first. */
  /** The vertex tool: on, the selected editable mesh shows its vertices and the move gizmo drags the chosen ones. */
  /** The selected slate, or the one the selected UI node is on, by itself over the viewport; off goes back to the scene. */
  private editSlate(on: boolean): void {
    const slate = on && this.selected ? slateOf(this.selected) : null
    if (slate) this.slateEditor.open(slate)
    else this.slateEditor.close()
    this.publishView()
  }

  private writeLayout(node: UIElement, layout: UILayout): void {
    node.x = layout.x
    node.y = layout.y
    node.width = layout.width
    node.height = layout.height
  }

  private setVertexEdit(on: boolean): void {
    this.camera.vertexEdit = on
    if (on) {
      this.camera.tool = null
      this.setGizmo("translate")
    }
    this.publishView()
  }

  /** What the vertex tool picks: vertices, edges or faces. The keys 1, 2 and 3 while the tool is on. */
  private setEditMode(mode: EditMode): void {
    if (!this.camera.vertexEdit) return
    this.camera.editMode = mode
    this.publishView()
  }

  /** A change to an editable mesh's vertices and faces together, as one undo step. */
  private editMesh(label: string, change: (mesh: EditMesh) => void): void {
    const mesh = this.selected
    if (!(mesh instanceof EditMesh) || !this.camera.vertexEdit) return
    const before = { vertices: mesh.vertices, faces: mesh.faces }
    change(mesh)
    const after = { vertices: mesh.vertices, faces: mesh.faces }
    const put = (state: typeof before) => () => {
      mesh.vertices = state.vertices
      mesh.faces = state.faces
      this.camera.clearElementSelection()
    }
    this.record(label, put(before), put(after))
    this.publishSelection()
  }

  /** Extrude the picked faces (X): the new faces are picked afterwards, ready to be moved. */
  private extrude(): void {
    if (this.camera.editMode !== "face" || this.camera.selectedFaces.size === 0) return
    this.editMesh("extrude", (mesh) => {
      const made = mesh.extrudeFaces(this.camera.selectedFaces)
      this.camera.selectFaces(made)
    })
  }

  /** The selected primitive becomes an editable mesh with the same shape, colour and place, in its place in the tree. */
  private convertToMesh(): void {
    const node = this.selected
    if (!node || node === this._root || !isPrimitive(node)) return
    const parent = node.parent as Node3D
    const index = parent.indexOf(node)
    const mesh = EditMesh.fromGeometry(node.mesh.geometry, { name: node.name, colour: node.colour, opacity: node.opacity, visualise: this.visualised })
    mesh.transform.position.copy(node.transform.position)
    mesh.transform.rotation.copy(node.transform.rotation)
    mesh.transform.scale.copy(node.transform.scale)
    const swap = (out: Node3D, into: Node3D) => {
      out.remove()
      parent.insertNode(into, index, into.name)
      this.select(into)
    }
    swap(node, mesh)
    this.record(`convert ${node.name} to mesh`, () => swap(mesh, node), () => swap(node, mesh))
  }

  /**
   * A hidden editable mesh that still collides is drawn as its edges in the
   * collider colour, so the shape can be found and picked while editing; a
   * visible one, or one that does not collide, has no ghost.
   */
  private placeGhosts(): void {
    const root = this._root
    const wanted = new Set<EditMesh>()
    root?.walk((node) => {
      if (node instanceof EditMesh && !node.visible && node.collide && (!(node.parent instanceof Node3D) || node.parent.isVisible)) wanted.add(node)
    })
    for (const [mesh, ghost] of this.ghosts) {
      if (wanted.has(mesh)) continue
      this.engine.scene.remove(ghost.visual)
      this.engine.renderer?.release(ghost.visual.geometry)
      this.ghosts.delete(mesh)
    }
    for (const mesh of wanted) {
      const world = mesh.transform.worldMatrix
      const ghost = this.ghosts.get(mesh)
      if (ghost && ghost.version === mesh.version && ghost.world.equals(world)) continue
      if (ghost) {
        this.engine.scene.remove(ghost.visual)
        this.engine.renderer?.release(ghost.visual.geometry)
      }
      const segments: number[] = []
      const a = new Vector3(), b = new Vector3()
      for (const [i, j] of mesh.edges()) {
        world.transformPoint(mesh.vertexAt(i, a), a)
        world.transformPoint(mesh.vertexAt(j, b), b)
        segments.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
      const visual = DebugShapes.segments(new Float32Array(segments), GHOST_COLOUR)
      this.engine.scene.add(visual)
      this.ghosts.set(mesh, { visual, version: mesh.version, world: world.clone() })
    }
  }

  /** What the inspector can do with a node of this kind, as buttons. */
  private nodeActions(node: Node3D): { id: string; label: string; title: string }[] {
    if (node instanceof EditMesh) return [{ id: "collisionMesh", label: "Make collision mesh", title: "A separate mesh collider child with this shape's triangles, for its own layers or to keep when the shape changes; the mesh's own collider is turned off" }]
    if (node instanceof Model) return [
      { id: "boundsCollider", label: "Collider from bounds", title: "A box collider child fitted to the model" },
      { id: "meshCollider", label: "Mesh collider", title: "A mesh collider child reading the model's file" },
    ]
    return []
  }

  private runNodeAction(id: string): void {
    if (id === "collisionMesh") this.addCollisionMesh()
    else if (id === "boundsCollider") this.addBoundsCollider()
    else if (id === "meshCollider") this.addMeshCollider()
  }

  /** A mesh collider child holding a copy of the editable mesh's triangles, saved with the scene; the mesh's own collider steps aside. */
  private addCollisionMesh(): void {
    const node = this.selected
    if (!(node instanceof EditMesh)) return
    const held = node.collider.held
    const collider = new MeshCollider({ name: "collision", triangles: { positions: Float32Array.from(held.positions), indices: held.indices ? Uint32Array.from(held.indices) : undefined }, visualise: this.visualised })
    const hadCollide = node.collide
    node.collide = false
    node.addNode(collider)
    if (this.visualised) collider.visualised = true
    this.collapsed.delete(node)
    const index = node.indexOf(collider)
    this.record(
      "make collision mesh",
      () => {
        collider.remove()
        node.collide = hadCollide
      },
      () => {
        node.insertNode(collider, index, collider.name)
        node.collide = false
      },
    )
    this.select(collider)
  }

  /** A mesh collider child reading the selected model's own file, so the physics world collides with its triangles. */
  private addMeshCollider(): void {
    const node = this.selected
    if (!node || node === this._root || !(node instanceof Model)) return
    const collider = new MeshCollider({ name: "meshCollider", url: node.url, visualise: this.visualised })
    node.addNode(collider)
    if (this.visualised) collider.visualised = true
    this.collapsed.delete(node)
    const index = node.indexOf(collider)
    this.record("add mesh collider", () => collider.remove(), () => node.insertNode(collider, index, collider.name))
    this.select(collider)
  }

  /** Show a file in the preview window: an image, or a model to turn over. */
  private async openPreview(path: string): Promise<void> {
    const folder = this.folder
    if (!folder || !PREVIEWED.test(path)) return
    try {
      if (/\.lsp$/i.test(path)) {
        const stylesheet = this.stylesheetShowing(path)
        const source = this.drafts.get(path) ?? (await folder.readText(path))
        const stylesheetText = stylesheet ? await this.readDraftOrFile(stylesheet) : ""
        this.releasePreview()
        this.set("editor:preview", { ...PREVIEW_DEFAULT, open: true, path, kind: "component", source, stylesheet, stylesheetText, stylesheets: this.projectFiles.filter((file) => /\.css$/i.test(file)) })
        return
      }
      if (PREVIEWED_MODEL.test(path)) {
        this.releasePreview()
        this.set("editor:preview", { ...PREVIEW_DEFAULT, open: true, path, kind: "model", loader: folderLoader(folder) })
        return
      }
      const url = URL.createObjectURL(await folder.readFile(path))
      this.releasePreview()
      this.set("editor:preview", { ...PREVIEW_DEFAULT, open: true, path, kind: "image", url })
    } catch (error) {
      this.set("editor:preview", { ...PREVIEW_DEFAULT, open: true, path, error: `${path} could not be read: ${error instanceof Error ? error.message : error}` })
    }
  }

  /** The stylesheet of the slate that shows a component in the scene, so its preview is styled as it is there. */
  private stylesheetShowing(component: string): string {
    let found = ""
    this._root?.walk((node) => {
      if (found || (node as Node3D & { source?: string }).source !== component) return
      for (let at = node.parent; at; at = at.parent) {
        if (at instanceof Slate) {
          found = at.stylesheet
          return
        }
      }
    })
    return found
  }

  private async readDraftOrFile(path: string): Promise<string> {
    return this.drafts.get(path) ?? (await this.folder?.readText(path).catch(() => "")) ?? ""
  }

  private async previewStylesheet(path: string): Promise<void> {
    const preview = this.app.shared("editor:preview").value as EditorCells["editor:preview"]
    if (!preview?.open || preview.kind !== "component") return
    this.set("editor:preview", { ...preview, stylesheet: path, stylesheetText: path ? await this.readDraftOrFile(path) : "" })
  }

  /** A component being previewed, or its stylesheet, follows the code pane's draft or save. */
  private followInPreview(path: string, text: string): void {
    const preview = this.app.shared("editor:preview").value as EditorCells["editor:preview"]
    if (!preview?.open || preview.kind !== "component") return
    if (preview.path === path) this.set("editor:preview", { ...preview, source: text })
    else if (preview.stylesheet === path) this.set("editor:preview", { ...preview, stylesheetText: text })
  }

  private closePreview(): void {
    this.releasePreview()
    this.set("editor:preview", PREVIEW_DEFAULT)
  }

  private releasePreview(): void {
    const url = (this.app.shared("editor:preview").value as EditorCells["editor:preview"] | undefined)?.url
    if (url) URL.revokeObjectURL(url)
  }

  private setStreamable(change: Partial<typeof STREAMABLE_DEFAULT>): void {
    this.set("editor:streamable", { ...this.app.shared("editor:streamable").value, ...change })
  }

  /** A project path as the converter takes it: absolute, for a project in a folder on disk. */
  private absolutePath(path: string): string | null {
    const transfer = this.folder?.transfer()
    return transfer?.kind === "path" ? `${transfer.path.replace(/\/+$/, "")}/${path}` : null
  }

  /** The dialog for a model file: its meshes and maps as the converter reads them, built beside the file by default. */
  private async openStreamable(path: string): Promise<void> {
    if (!this.converter || this.streamJob) return
    const absolute = this.absolutePath(path)
    if (!absolute) return this.publishProject("making a model streamable needs a project folder on disk")
    const stem = path.replace(/^.*\//, "").replace(/\.[^.]+$/, "")
    const dir = path.includes("/") ? path.replace(/\/[^/]*$/, "") : ""
    this.set("editor:streamable", { ...STREAMABLE_DEFAULT, available: true, open: true, phase: "reading", source: path, out: dir ? `${dir}/${stem}.theca` : `${stem}.theca` })
    try {
      const meshes = await this.converter.describe(absolute)
      const first = meshes.find((mesh) => mesh.buildable)
      this.setStreamable({ phase: "choose", meshes, mesh: first?.index ?? 0, error: first ? "" : "No mesh in this file can be built: each needs a single primitive with UVs." })
    } catch (error) {
      this.setStreamable({ phase: "failed", error: error instanceof Error ? error.message : String(error) })
    }
  }

  private async startStreamable(out: string, addToScene: boolean, options: StreamableOptions): Promise<void> {
    const state = this.app.shared("editor:streamable").value as typeof STREAMABLE_DEFAULT
    const folder = this.folder
    if (!this.converter || this.streamJob || !folder) return
    const target = out.trim().replace(/^\/+|\/+$/g, "")
    if (!target || target.split("/").some((part) => part === ".." || part === "." || part === "")) return this.setStreamable({ error: "The output folder must be a path inside the project." })
    // A folder already there is replaced only when it is an earlier build, never anything else.
    const there = await folder.raw.list(target).catch(() => [])
    const earlier = async () => (await folder.raw.exists(`${target}/${THECA_MANIFEST}`).catch(() => false)) || (await folder.raw.exists(`${target}/clusters/manifest.json`).catch(() => false))
    if (there.length > 0 && !(await earlier())) {
      return this.setStreamable({ error: `${target} is already a folder that is not a streamable build; choose another name.` })
    }
    const input = this.absolutePath(state.source)
    const output = this.absolutePath(target)
    if (!input || !output) return
    this.streamCancelled = false
    this.setStreamable({ phase: "running", out: target, error: "", stage: "", step: 0, steps: 0, fraction: null, message: "Starting" })
    const maps = (state.rebuild?.maps ?? []).map((map) => ({ role: map.role, path: this.absolutePath(map.path) ?? map.path }))
    const job = this.converter.makeStreamable(input, output, { ...options, maps }, (progress) =>
      this.setStreamable({ stage: progress.stage, step: progress.step, steps: progress.steps, fraction: progress.fraction, ...(progress.message ? { message: progress.message } : {}) }),
    )
    this.streamJob = job
    try {
      const result = await job.result
      this.streamJob = null
      await this.publishFiles()
      const name = state.source.replace(/^.*\//, "").replace(/\.[^.]+$/, "")
      if (addToScene) {
        if (THECA.test(target)) await this.addNode("StreamedSurface", { name, theca: target })
        else await this.addNode("StreamedSurface", { name, clusters: `${target}/${result.clusters}`, tiles: result.tiles ? `${target}/${result.tiles}` : "" })
      }
      const maps = result.maps.map((map) => MAP_NAMES[map.role] ?? map.role).join(", ")
      this.setStreamable({
        phase: "done",
        warnings: result.warnings,
        summary: `${result.triangles.toLocaleString()} triangles into ${THECA.test(target) ? target : `${target}/${result.clusters}`}${maps ? `, with tile pyramids for ${maps}` : ", geometry only"}${addToScene ? "; added to the scene" : ""}.`,
      })
    } catch (error) {
      this.streamJob = null
      if (this.streamCancelled) this.setStreamable({ phase: "choose", message: "", error: "Stopped; nothing was written." })
      else this.setStreamable({ phase: "failed", error: error instanceof Error ? error.message : String(error) })
    }
  }

  private async readTheca(path: string): Promise<ThecaManifest | null> {
    return (await this.folder?.raw.readJSON<ThecaManifest>(`${path}/${THECA_MANIFEST}`).catch(() => null)) ?? null
  }

  /** A streamed surface showing a theca, named after it. */
  private async addTheca(path: string, at?: Vector3): Promise<void> {
    const manifest = await this.readTheca(path)
    if (!manifest) return this.publishProject(`${path} has no ${THECA_MANIFEST}; build it again with Make streamable`)
    await this.addNode("StreamedSurface", { name: manifest.name ?? path.replace(/^.*\//, "").replace(THECA, ""), theca: path }, at)
  }

  /** A path a theca records relative to the folder it sits in, as a project path; null when it climbs out of the project. */
  private besideTheca(theca: string, relative: string): string | null {
    const resolved: string[] = []
    for (const part of [...(theca.includes("/") ? theca.replace(/\/[^/]*$/, "").split("/") : []), ...relative.split("/")]) {
      if (part === "..") {
        if (!resolved.length) return null
        resolved.pop()
      } else if (part && part !== ".") resolved.push(part)
    }
    return resolved.join("/")
  }

  /** The dialog again for a theca's source, with the options and map files it was built with. */
  private async rebuildTheca(path: string): Promise<void> {
    const manifest = await this.readTheca(path)
    if (manifest?.packed) return this.publishProject(`${path} was packed from an earlier build; rebuild it with iapetus pack`)
    const from = manifest?.source?.path
    if (!manifest || !from) return this.publishProject(`${path} does not say what it was built from`)
    const source = this.besideTheca(path, from)
    if (!source) return this.publishProject(`${path} was built from ${from}, outside the project`)
    if (!(await this.folder?.exists(source).catch(() => false))) return this.publishProject(`${path} was built from ${source}, which is not in the project now`)
    const maps: { role: string; path: string }[] = []
    for (const map of manifest.options?.maps ?? []) {
      const file = this.besideTheca(path, map.path)
      if (!file || !(await this.folder?.exists(file).catch(() => false))) return this.publishProject(`${path} was built with ${map.path} as its ${MAP_NAMES[map.role] ?? map.role} map, which is not in the project now`)
      maps.push({ role: map.role, path: file })
    }
    await this.openStreamable(source)
    const options = manifest.options ?? {}
    this.setStreamable({ out: path, mesh: manifest.source?.mesh ?? 0, rebuild: { permissive: Boolean(options.permissive), partition: Boolean(options.partition), maxTexture: options.maxTexture ?? 16384, maps } })
  }

  private cancelStreamable(): void {
    if (!this.streamJob) return
    this.streamCancelled = true
    this.setStreamable({ message: "Stopping" })
    this.streamJob.cancel()
  }

  private async addNode(kind: string, given?: Record<string, unknown>, at?: Vector3, under?: Node3D): Promise<void> {
    const parent = under ?? this.selected ?? this._root
    const definition = kind.startsWith(PREFAB_KIND) ? this.prefabKind(kind.slice(PREFAB_KIND.length)) : this.recipe.kinds.find((k) => k.kind === kind)
    if (!parent || !definition) return
    let picked: Record<string, unknown> = given ?? {}
    if (!given && definition.pick) {
      if (!this.folder) return this.publishProject("the project needs a folder before files can be imported")
      const result = await definition.pick(this.folder)
      if (!result) return
      picked = result
    }
    if (parent !== (under ?? this.selected ?? this._root)) return
    const node = definition.make({ name: `${definition.kind.charAt(0).toLowerCase()}${definition.kind.slice(1)}`, visualise: this.visualised, ...picked })
    // A UI node only draws on a slate: added elsewhere, it goes on the scene's first slate, or a new one
    let target = parent
    let added: Node3D = node
    if (node instanceof UIElement && !(parent instanceof Slate || parent instanceof UIElement)) {
      const slate = this.firstSlate()
      if (slate) target = slate
      else {
        added = new Slate()
        added.addNode(node)
        target = this._root!
      }
    }
    if (added instanceof Slate && target !== this._root && isSpatial(target)) added.space = "world"
    target.addNode(added)
    if (added instanceof Slate && added.space === "world" && !at) added.transform.position.set(0, 0, 0)
    else if (isSpatial(added)) added.transform.setWorldPosition(at ?? (this.camera.isActive ? this.camera.orbitTarget : new Vector3(0, 1, 0)))
    if (this.visualised) node.visualised = true
    this.collapsed.delete(target)
    this.collapsed.delete(added)
    const index = target.indexOf(added)
    this.record(`add ${definition.label.toLowerCase()}`, () => added.remove(), () => target.insertNode(added, index, added.name))
    this.select(node)
  }

  private firstSlate(): Slate | null {
    let found: Slate | null = null
    this._root?.walk((node) => {
      if (found) return false
      if (node instanceof Slate && !node.internal) found = node
    })
    return found
  }

  /** A kind for one of the project's prefab files, named after the file. */
  private prefabKind(path: string): NodeKind | undefined {
    const prefab = this.prefabs.find((p) => p.path === path)
    if (!prefab) return undefined
    const name = prefab.name.slice(prefab.name.lastIndexOf("/") + 1)
    return { kind: name, label: name, cls: Prefab, make: (o) => new Prefab({ ...o, url: path }) }
  }

  private deleteSelected(): void {
    // In the vertex tool, Delete is for the picked elements; with none picked it does nothing rather than take the node.
    if (this.camera.vertexEdit && this.selected instanceof EditMesh && !this.camera.hasElementSelection) return
    if (this.camera.vertexEdit && this.selected instanceof EditMesh && this.camera.hasElementSelection) {
      const mode = this.camera.editMode
      this.editMesh(`delete ${mode === "vertex" ? "vertices" : mode === "edge" ? "edges" : "faces"}`, (mesh) => {
        if (mode === "vertex") mesh.deleteVertices(this.camera.selectedVertices)
        else if (mode === "edge") mesh.deleteEdges(this.camera.selectedEdges)
        else mesh.deleteFaces(this.camera.selectedFaces)
      })
      return
    }
    const nodes = this.selectionRoots()
    if (nodes.length === 0) return
    if (this.inheritedAmong(nodes, "deleted")) return
    this.camera.detach()
    const places = nodes.map((node) => ({ node, parent: node.parent as Node3D, index: (node.parent as Node3D).indexOf(node) })).sort((a, b) => a.index - b.index)
    const remove = () => {
      for (const { node } of places) node.remove()
    }
    const restore = () => {
      for (const { node, parent, index } of places) parent.insertNode(node, index, node.name)
    }
    remove()
    this.record(places.length > 1 ? `delete ${places.length} nodes` : `delete ${places[0].node.name}`, restore, remove)
    this.select(null)
  }

  /** In a variant, the nodes its base gives stay where the base has them: says so and gives true when any of `nodes` is one. */
  private inheritedAmong(nodes: Node3D[], done: string): boolean {
    const root = this._root
    const inherited = root ? nodes.find((node) => this.variants.isInherited(node, root)) : undefined
    if (!inherited) return false
    this.publishProject(`${inherited.name} comes from ${this.variants.base}, so it can't be ${done} here; turn it off with Active, or change it in the base`)
    return true
  }

  /** Reparent or reorder nodes, keeping their world transforms and tree order. */
  private moveNodes(ids: number[], targetId: number, place: DropPlace): void {
    const target = this.nodesById.get(targetId)
    const root = this._root
    if (!target || !root) return
    const order = this.visibleNodes().map((row) => row.node)
    const nodes = ids
      .map((id) => this.nodesById.get(id))
      .filter((node): node is Node3D => node !== undefined && node !== root && node !== target)
      .filter((node, _, all) => !all.some((other) => other !== node && other.contains(node)))
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    if (nodes.length === 0 || nodes.some((node) => node.contains(target))) return
    if (this.inheritedAmong(nodes, "moved")) return
    const newParent = place === "inside" ? target : target.parent
    if (!(newParent instanceof Node3D)) return
    this.reparent(nodes, newParent, place === "inside" ? newParent.children.size : newParent.indexOf(target) + (place === "after" ? 1 : 0))
  }

  /** A name no child of the parent has, numbering the given one as `addNode` does. */
  private freeName(parent: Node3D, name: string, except: Node3D): string {
    const taken = (candidate: string) => parent.children.has(candidate) && parent.children.get(candidate) !== except
    if (!taken(name)) return name
    let n = 2
    while (taken(`${name}${n}`)) n++
    return `${name}${n}`
  }

  /**
   * Put nodes under a parent at an index, keeping their world transforms
   * and relative order, renaming one whose name the parent already has. Undo
   * puts them back where they were, with their old names.
   */
  private reparent(nodes: Node3D[], newParent: Node3D, at: number): void {
    const before = nodes.map((node) => ({ node, parent: node.parent as Node3D, index: (node.parent as Node3D).indexOf(node), name: node.name, world: node.transform.worldMatrix.clone() }))
    const renamed: string[] = []
    const placeAll = () => {
      for (const node of nodes) node.remove()
      let index = at
      for (const { node, name: was, world } of before) {
        const name = this.freeName(newParent, node.name, node)
        if (name !== node.name) {
          node.rename(name)
          renamed.push(`${was} → ${name}`)
        }
        newParent.insertNode(node, index++, name)
        node.transform.setWorldMatrix(world)
      }
    }
    const putBack = () => {
      for (const { node } of before) node.remove()
      for (const { node, parent, index, name, world } of [...before].sort((a, b) => a.index - b.index)) {
        node.rename(name)
        parent.insertNode(node, index, name)
        node.transform.setWorldMatrix(world)
      }
    }
    // Fields and connections name nodes by path, which a move changes.
    const fields = this.wiring.nodeReferences()
    const references = this.wiring.referencesTo(nodes)
    const follow = () => {
      this.wiring.repoint(fields)
      if (references.length) void this.wiring.retarget(references).catch((error: unknown) => this.publishProject(error instanceof Error ? error.message : String(error)))
    }
    placeAll()
    follow()
    this.record(
      nodes.length > 1 ? `move ${nodes.length} nodes` : `move ${nodes[0].name}`,
      () => {
        putBack()
        follow()
      },
      () => {
        placeAll()
        follow()
      },
    )
    if (renamed.length) this.publishProject(`renamed ${renamed.join(", ")}: the name was taken under ${newParent.name}`)
    this.collapsed.delete(newParent)
    this.camera.syncFromTarget()
    this.publishTree()
    this.publishSelection()
  }

  /** Copies of the selected nodes through the scene JSON, each after its original with a free name; the copies become the selection. */
  private duplicateSelected(): void {
    const nodes = this.selectionRoots()
    if (nodes.length === 0) return
    const copies = nodes.map((node) => {
      const parent = node.parent as Node3D
      const copy = this.engine.create(this.engine.serialise(node)) as Node3D
      copy.rename(this.freeName(parent, node.name, copy))
      return { copy, parent, index: parent.indexOf(node) + 1 }
    })
    const place = () => {
      for (const { copy, parent, index } of [...copies].reverse()) parent.insertNode(copy, index, copy.name)
    }
    const remove = () => {
      for (const { copy } of copies) copy.remove()
    }
    place()
    if (this.visualised) for (const { copy } of copies) copy.walk((node) => {
      if (node instanceof Node3D) node.visualised = true
    })
    this.record(copies.length > 1 ? `duplicate ${copies.length} nodes` : `duplicate ${nodes[0].name}`, remove, place)
    const last = copies[copies.length - 1].copy
    this.selection = new Set(copies.map((c) => c.copy))
    this.selected = last
    this.anchor = last
    this.attachGizmo(last)
    this.publishTree()
    this.publishSelection()
  }

  /** Move the selected nodes up a level, beside their parent, keeping their world transforms. */
  private unparent(): void {
    const root = this._root
    if (!root) return
    const nodes = this.selectionRoots().filter((node) => node.parent instanceof Node3D && node.parent !== root)
    if (nodes.length === 0) return
    const parent = nodes[0].parent as Node3D
    const grandparent = parent.parent as Node3D
    if (!grandparent) return
    this.reparent(nodes.filter((node) => node.parent === parent), grandparent, grandparent.indexOf(parent) + 1)
  }
}

const degrees = (radians: number): number => (radians * 180) / Math.PI
const radians = (degrees: number): number => (degrees * Math.PI) / 180

/** A box's dimensions, for undo; null for a node without them. */
const slateOf = (node: Node3D): Slate | null => (node instanceof Slate ? node : node instanceof UIElement ? node.slate : null)

const isTyping = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null
  return !!element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable)
}

const isSpatial = (node: Node3D): boolean => (node instanceof Slate ? node.space === "world" : !(node instanceof UIElement))

const sizeOf = (node: Node3D): Vector3 | null => (isSized(node) ? new Vector3(node.width, node.height, node.depth) : null)

/** The blocking-in prefabs: a mesh child with a colour and an opacity, which an editable mesh can take over. */
const isPrimitive = (node: Node3D): node is Primitive => node instanceof Primitive

/** The collider colour, for a hidden mesh's ghost outline. */
const GHOST_COLOUR = 0xff00ff

/** A file's size and date as the files pane shows them. */
const fileFacts = (bytes: number, modified: number): string => {
  const size = bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return modified ? `${size} · ${new Date(modified).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : size
}
