import { Mat4, Model, Node3D, Prefab, Quaternion, Vector3, editorIcon, exposedProperties, readExposed, writeExposed, type Catalyst, type ExposedProperty, type NodeClass, type NodeJSON, type Script } from "@nickpaustian/catalyst"
import { Input } from "@nickpaustian/catalyst/input"
import { BoxCollider, MeshCollider, Physics } from "@nickpaustian/catalyst/physics"
import type { LightspeedRuntime } from "@lightspeed-js/core"
import { EditorCamera, groupTarget, type GizmoMode, isSized, type DrawTool, type DrawnBox } from "./EditorCamera"
import { EditorInput } from "./EditorInput"
import { History } from "./History"
import { preferences, type SnapSettings, streamingQualityOf, type StreamingPreset } from "./preferences"
import { browserFolders, folderLoader, pickFile, type FolderSource, type ProjectFolder, type ProjectStorage, type RecentProject } from "./ProjectFolder"
import { windowRunnerLink, type RunnerLink } from "./RunnerLink"
import { SCRIPTS_DIR, ScriptCompiler, scriptTemplate } from "./ScriptCompiler"
import { LEGACY_PROJECT_FILE, PROJECT_EXTENSION, createProject, readProjectImage, readProjectSettings, writeProjectImage, writeProjectSettings, type NewProject, type ProjectSettings } from "./project"
import { openConfirm } from "./confirm"
import { PROJECT_DIALOG_DEFAULT } from "./cells"
import type { NodeKind, Recipe } from "./recipe"

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
}

/** A script on the selected node: built, with its fields, or still named by a file that could not be built. */
export interface SelectionScript {
  index: number
  url: string
  name: string
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
  /** The recipes a project may use. */
  "editor:recipes": string[]
  "editor:history": { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null }
  /** The recipe's project-wide settings, or null when it has none. */
  "editor:settings": { title: string; fields: SelectionProperty[] } | null
  "editor:view": { view: ViewMode; visualised: boolean; gizmo: GizmoMode; tool: DrawTool | null; physics: boolean; scripts: boolean; snap: SnapSettings; streaming: StreamingPreset }
  "editor:tree": TreeRow[]
  /** The kinds the tree can add, as the class hierarchy they sit in: bases that are not kinds are shown but cannot be added. */
  "editor:kinds": KindNode[]
  /** Set true to open the add dialog; the dialog sets it back. */
  "editor:addDialog": boolean
  /** The script files in the project, offered to attach. */
  "editor:scripts": { path: string; name: string }[]
  /** The project folder's files as a tree, for the files pane; empty with no project. */
  "editor:files": FileTree[]
  /** The file the files pane has selected: its size, when it changed, and a preview of an image. */
  "editor:fileInfo": { path: string; size: number; modified: number; preview: string | null } | null
  /** The script file open in the code pane: its text as last read or saved, and what happened on the last save. */
  "editor:code": { path: string | null; text: string; status: string }
  /** Bumped when everything should save: the code pane answers with its unsaved file. */
  "editor:saveRequest": number
  "editor:selection": {
    id: number
    name: string
    type: string
    icon: string
    count: number
    parent: string | null
    /** The file a prefab instance follows, or null for any other node. */
    prefab: string | null
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number }
    properties: SelectionProperty[]
    scripts: SelectionScript[]
  } | null
}

export type EditorCommand =
  | { type: "newProject"; name?: string }
  | { type: "openFolder" }
  | { type: "reopenLast" }
  | { type: "openRecent"; id: string }
  | { type: "forgetRecent"; id: string }
  | { type: "locateRecent"; id: string }
  | { type: "closeProject" }
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
  | { type: "setSnap"; snap: Partial<SnapSettings> }
  | { type: "setStreaming"; preset: StreamingPreset }
  | { type: "select"; id: number; mode?: SelectMode }
  | { type: "add"; kind: string; options?: Record<string, unknown> }
  | { type: "toggleExpand"; id: number }
  | { type: "move"; ids: number[]; targetId: number; place: DropPlace }
  | { type: "delete" }
  | { type: "duplicate" }
  | { type: "unparent" }
  | { type: "makePrefab" }
  | { type: "unpackPrefab" }
  | { type: "attachScript"; url: string }
  | { type: "attachScriptTo"; id: number; url: string }
  | { type: "detachScript"; index: number }
  | { type: "setScriptProperty"; index: number; key: string; value: unknown }
  | { type: "newScript"; name: string; attach?: boolean }
  | { type: "reloadScripts" }
  | { type: "openScript"; path: string }
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
  | { type: "saveScript"; path: string; text: string }
  | { type: "closeScript" }
  | { type: "focus" }
  | { type: "setTransform"; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }
  | { type: "setProperty"; key: string; value: unknown }
  | { type: "rename"; name: string }
  | { type: "setSetting"; key: string; value: unknown; pick?: boolean }

const round = (n: number, places = 4) => Number(n.toFixed(places))
const toStrings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : String(value ?? "").split(","))
const LIST_TYPES: ExposedProperty["type"][] = ["tags", "layers"]
export const PREFABS_DIR = "prefabs"
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

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
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
  private readonly input: EditorInput | null
  private folder: ProjectFolder | null = null
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
  private readonly history = new History()
  private dragStart: { node: Node3D; before: Mat4; size: Vector3 | null }[] | null = null
  private selected: Node3D | null = null
  private selection = new Set<Node3D>()
  private anchor: Node3D | null = null
  private ids = new Map<Node3D, number>()
  private nodesById = new Map<number, Node3D>()
  private nextId = 1
  private collapsed = new Set<Node3D>()
  private prefabs: { path: string; name: string }[] = []
  private scriptFiles: { path: string; name: string }[] = []
  private compiler: ScriptCompiler | null = null
  private unsubscribeCommands: () => void
  private unsubscribeBlur: () => void
  private readonly folders: FolderSource
  private readonly runner: RunnerLink
  private runnerReady = false
  private readonly unsubscribeRunner: () => void
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "Shift") this.setSnapInverted(false)
  }
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Shift") this.setSnapInverted(true)
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

  constructor(options: { app: LightspeedRuntime; engine: Catalyst; recipe: Recipe; folders?: FolderSource; runner?: RunnerLink }) {
    this.app = options.app
    this.engine = options.engine
    this.recipe = options.recipe
    this.folders = options.folders ?? browserFolders
    this.runner = options.runner ?? windowRunnerLink()
    const unsubscribeReady = this.runner.onReady(() => {
      this.runnerReady = true
      this.sendToRunner()
    })
    const unsubscribeClosed = this.runner.onClosed(() => {
      this.runnerReady = false
      this.set("editor:running", false)
      if (this.app.shared("editor:project").value?.status === "running") this.publishProject()
    })
    this.unsubscribeRunner = () => {
      unsubscribeReady()
      unsubscribeClosed()
    }
    this.camera = new EditorCamera(this.engine)
    for (const { kind, cls } of this.recipe.kinds) if (!this.engine.registry.has(kind) && typeof cls === "function") this.engine.register({ [kind]: cls as NodeClass })
    const input = this.engine.find(Input)
    this.input = input ? new EditorInput(input, { focusSelected: () => this.focusSelected(), deleteSelected: () => this.deleteSelected(), moveTool: () => this.setGizmo("translate"), rotateTool: () => this.setGizmo("rotate"), scaleTool: () => this.setGizmo("scale"), boxTool: () => this.setTool("box"), colliderTool: () => this.setTool("collider") }) : null
    const physics = this.engine.find(Physics)
    if (physics) physics.paused = true
    this.engine.scripts.setRunning(false, this.engine.root, this.engine)
    this.history.onChange = () => {
      this.publishHistory()
      this.publishProject()
    }
    this.camera.onDrag = (dragging) => (dragging ? this.beginDrag() : this.endDrag())
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
      if (command) void this.handle(command as EditorCommand)
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
    this.set("editor:fileInfo", null)
    this.set("editor:code", { path: null, text: "", status: "" })
    this.set("editor:saveRequest", 0)
    this.set("editor:projectDialog", PROJECT_DIALOG_DEFAULT)
    this.set("editor:recipes", [this.recipe.name])
    this.setView("orbit")
    void this.publishRecent()
  }

  get root(): Node3D | null {
    return this._root
  }

  /** Put a project in the viewport: the folder's, or a fresh one when there is no folder. */
  async open(folder: ProjectFolder | null): Promise<void> {
    this.close()
    this.folder = folder
    this.settings = folder ? await readProjectSettings(folder) : null
    this.engine.loader = folder ? folderLoader(folder) : this.engine.loader
    this.useFolderScripts()
    this.set("editor:code", { path: null, text: "", status: "" })
    this.set("editor:projectDialog", PROJECT_DIALOG_DEFAULT)
    this.publishProject(folder ? `opening ${folder.name}` : "new project")
    const root = await this.recipe.load(folder, this.engine)
    this._root = root
    this.engine.add(root)
    this.setVisualised(this.visualised)
    await this.loadPrefabs()
    await this.loadScriptFiles()
    this.history.clear()
    this.publishSettings()
    this.publishProject(folder ? "" : "unsaved")
    this.publishTree()
    this.select(null)
    this.camera.focusPoint(new Vector3(0, 0.5, 0), 8)
    if (folder) await folder.remember()
    void this.publishRecent()
    if (folder?.watch) {
      try {
        this.unwatch = await folder.watch((paths) => this.onDiskChange(paths))
      } catch (error) {
        this.engine.log(`the project folder is not watched: ${error instanceof Error ? error.message : error}`, "editor")
      }
    }
  }

  /** Read the project's files again and rebuild the scene from them, dropping unsaved changes. */
  async reloadProject(): Promise<void> {
    const folder = this.folder
    if (!folder) return
    await this.open(folder)
    this.publishProject("reloaded from disk")
  }

  /** Take the project out of the viewport and show the start screen again. */
  closeProject(): void {
    this.close()
    this.folder = null
    this.settings = null
    this.set("editor:code", { path: null, text: "", status: "" })
    this.publishSettings()
    this.publishTree()
    this.publishProject()
    void this.publishRecent()
  }

  private close(): void {
    this.unwatch?.()
    this.unwatch = null
    this.select(null)
    this._root?.dispose()
    this._root = null
    this.ids.clear()
    this.nodesById.clear()
    this.collapsed.clear()
  }

  dispose(): void {
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

  private publishSettings(): void {
    const settings = this.recipe.settings
    if (!settings || !this._root) return this.set("editor:settings", null)
    const values = settings.read(this.engine, this._root)
    this.set("editor:settings", { title: settings.title, fields: settings.fields.map((field) => ({ ...field, label: field.label ?? field.key, value: values[field.key] })) })
  }

  private publishHistory(): void {
    this.set("editor:history", { canUndo: this.history.canUndo, canRedo: this.history.canRedo, undoLabel: this.history.undoLabel, redoLabel: this.history.redoLabel })
  }

  /** The viewport's streaming cap from the preference; a run's engine is separate and keeps the scene's own. */
  private applyStreaming(): void {
    Object.assign(this.engine.streaming, streamingQualityOf(this.streaming))
  }

  private publishView(): void {
    this.set("editor:view", { view: this.view, visualised: this.visualised, gizmo: this.gizmo, tool: this.camera.tool, physics: !(this.engine.find(Physics)?.paused ?? true), scripts: this.engine.scripts.running, snap: this.snap, streaming: this.streaming })
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
  }

  private endDrag(): void {
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

  private visibleNodes(): { node: Node3D; depth: number }[] {
    const rows: { node: Node3D; depth: number }[] = []
    const visit = (node: Node3D, depth: number) => {
      rows.push({ node, depth })
      if (!this.collapsed.has(node)) this.ownedChildren(node).forEach((child) => visit(child, depth + 1))
    }
    if (this._root) visit(this._root, 0)
    return rows
  }

  private publishTree(): void {
    this.set(
      "editor:tree",
      this.visibleNodes().map(({ node, depth }) => ({
        id: this.idOf(node),
        name: node.name,
        type: this.engine.registry.typeOf(node),
        icon: editorIcon(node),
        depth,
        hasChildren: this.ownedChildren(node).length > 0,
        expanded: !this.collapsed.has(node),
        selected: this.selection.has(node),
        active: node === this.selected,
        isRoot: node === this._root,
      })),
    )
  }

  private publishSelection(): void {
    const node = this.selected
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
      position: { x: round(p.x), y: round(p.y), z: round(p.z) },
      rotation: { x: round(degrees(e.x), 2), y: round(degrees(e.y), 2), z: round(degrees(e.z), 2) },
      properties: exposedProperties(node)
        .map((property) => ({ ...property, label: property.label ?? property.key, value: readExposed(node, property) }))
        .sort((a, b) => Number(LIST_TYPES.includes(a.type)) - Number(LIST_TYPES.includes(b.type))),
    })
  }

  //=========================
  // Commands
  //=========================

  private async handle(command: EditorCommand): Promise<void> {
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
        this.closeProject()
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
        this.engine.scripts.setRunning(!this.engine.scripts.running, this.engine.root, this.engine)
        this.publishView()
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
        this.writeScriptProperty(command.index, command.key, command.value)
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
        if (/\.(ts|js)$/.test(command.path)) await this.openScript(command.path)
        break
      case "addModel":
        await this.addNode("Model", { url: command.path, name: command.path.replace(/^.*\//, "").replace(/\.[^.]+$/, "") })
        break
      case "useEnvironment":
        this.writeSetting("environment", command.path)
        break
      case "saveScript":
        await this.saveScript(command.path, command.text)
        break
      case "closeScript":
        this.set("editor:code", { path: null, text: "", status: "" })
        break
      case "focus":
        this.focusSelected()
        break
      case "setTransform":
        this.writeTransform(command.position, command.rotation)
        break
      case "setProperty":
        this.writeProperty(command.key, command.value)
        break
      case "rename":
        this.renameSelected(command.name)
        break
      case "setSetting":
        if (command.pick) void this.pickSetting(command.key)
        else this.writeSetting(command.key, command.value)
        break
    }
  }

  /** A fresh project: straight into the browser's storage under a name when one is given, else through the dialog. */
  private async newProject(name?: string): Promise<void> {
    if (name && this.folders.hasBrowserStorage) {
      await this.open(await createProject(this.folders, { name, recipe: this.recipe.name, description: "", location: null }))
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
    try {
      const folder = await createProject(this.folders, fields)
      if (!(await folder.ensurePermission())) return
      await this.open(folder)
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
    if (scene && !this.history.isDirty) {
      await this.reloadProject()
      this.publishProject("reloaded from disk: the scene changed outside")
      return
    }
    if (scene) this.askAboutSceneOnDisk()
    void this.publishFiles()
    const notes: string[] = []
    if (scripts.length) {
      await this.reloadScripts()
      const code = this.app.shared("editor:code").value as EditorCells["editor:code"] | undefined
      if (code?.path && scripts.includes(code.path)) {
        try {
          this.set("editor:code", { path: code.path, text: await folder.readText(code.path), status: `reloaded ${code.path} from disk` })
        } catch {}
      }
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
      { label: "Reload from disk", primary: true, run: () => void this.reloadProject() },
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
      this.sendToRunner()
      this.runner.focus()
      return
    }
    this.runnerReady = false
    const url = new URL("play.html", location.href)
    url.searchParams.set("recipe", this.recipe.name)
    if (!this.runner.open(url.href)) return this.publishProject("the runner window could not be opened")
    this.set("editor:running", true)
  }

  private sendToRunner(): void {
    if (!this.runner.isOpen || !this._root) return
    const scene = this.recipe.serialise?.(this._root, this.engine) ?? this.engine.serialise(this._root)
    this.runner.send({ type: "catalyst:run", recipe: this.recipe.name, scene, folder: this.folder?.transfer() ?? null })
    this.publishProject("running")
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
    const written = await this.recipe.save(folder, this._root, this.engine)
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
    const folder = await this.folders.pick()
    if (!folder) return
    if (!(await folder.ensurePermission())) return
    this.folder = folder
    await folder.remember()
    void this.publishRecent()
    this.engine.loader = folderLoader(folder)
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
      built: true,
      fields: exposedProperties(script).map((property) => ({ ...property, label: property.label ?? property.key, value: readExposed(script, property) })),
    }))
    const pending = node.pendingScripts.map((json, i) => ({ index: node.scripts.length + i, url: json.url, name: name(json.url), built: false, fields: [] }))
    return [...built, ...pending]
  }

  /** Attach a script file to the selected node; its fields appear once it is built. */
  private async attachScript(url: string, node: Node3D | null = this.selected): Promise<void> {
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
    const node = this.selected
    if (!node) return
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

  private writeScriptProperty(index: number, key: string, value: unknown): void {
    const node = this.selected
    const script = node?.scripts[index]
    if (!node || !script) return
    const property = exposedProperties(script).find((p) => p.key === key)
    if (!property || property.readonly) return
    const next = this.coerce(property, value)
    if (next === undefined) return
    const before = readExposed(script, property)
    if (JSON.stringify(before) === JSON.stringify(next)) return
    writeExposed(script, property, next)
    this.record(property.label ?? key, () => writeExposed(script, property, before), () => writeExposed(script, property, next), `script:${this.idOf(node)}:${index}:${key}`)
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
    const code = this.app.shared("editor:code").value as EditorCells["editor:code"] | undefined
    if (code?.path === from) this.set("editor:code", { ...code, path: to })
    await this.loadScriptFiles()
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
              const code = this.app.shared("editor:code").value as EditorCells["editor:code"] | undefined
              if (code?.path === path) this.set("editor:code", { path: null, text: "", status: "" })
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
    try {
      const info = await folder.stat(path)
      let preview: string | null = null
      if (/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(path) && info.size <= PREVIEW_BYTES) {
        const file = await folder.readFile(path)
        preview = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
      }
      this.set("editor:fileInfo", { path, size: info.size, modified: info.modified, preview })
    } catch {
      this.set("editor:fileInfo", null)
    }
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
    if (generation === this.filesGeneration && this.folder === folder) this.set("editor:files", tree)
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

  private async openScript(path: string): Promise<void> {
    const folder = this.folder
    if (!folder) return
    try {
      this.set("editor:code", { path, text: await folder.readText(path), status: "" })
    } catch {
      this.publishProject(`${path} could not be read`)
    }
  }

  /** Write a script file from the code pane and rebuild every script, reporting a build error against the file. */
  private async saveScript(path: string, text: string): Promise<void> {
    const folder = this.folder
    if (!folder) return
    await folder.writeText(path, text)
    await this.reloadScripts()
    this.compiler?.invalidate(path)
    this.engine.scripts.invalidate(path)
    let status = `saved ${path}`
    try {
      await this.engine.scripts.load(path)
    } catch (error) {
      status = error instanceof Error ? error.message : String(error)
    }
    this.set("editor:code", { path, text, status })
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
    await this.loadScriptFiles()
    this.publishProject(urls.size ? `rebuilt ${urls.size} script${urls.size === 1 ? "" : "s"}` : "no scripts in the scene")
    this.publishSelection()
  }

  //=========================
  // Prefabs
  //=========================

  /** The prefab files in the project, offered as kinds to add. */
  private async loadPrefabs(): Promise<void> {
    const files = this.folder ? await this.folder.list(PREFABS_DIR) : []
    this.prefabs = files.filter((file) => file.kind === "file" && file.name.endsWith(".json")).map((file) => ({ path: file.path, name: file.name.slice(0, -5) }))
    this.publishKinds()
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

  /** After a prefab file is written: every instance of it in the scene follows. */
  private async reloadInstances(path: string, except?: Prefab): Promise<void> {
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
    this.publishView()
  }

  /** The draw tools stay on between boxes; pressing the same tool's key again, or a gizmo key, leaves them. */
  private setTool(tool: DrawTool | null): void {
    this.camera.tool = this.camera.tool === tool ? null : tool
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
    this.publishTree()
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
    this.publishTree()
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
    if (this.selection.size > 1) this.camera.attachTarget(groupTarget(this.selectionRoots(), node), changed)
    else this.camera.attach(node, changed)
  }

  private focusSelected(): void {
    if (!this.selected || !this.camera.isActive) return
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
    const before = node.name
    if (!node.rename(clean)) {
      this.publishProject(`"${clean}" already exists under ${node.parent?.name}`)
      this.publishSelection()
      return
    }
    this.record("rename", () => node.rename(before), () => node.rename(clean))
    this.publishTree()
    this.publishSelection()
  }

  private writeProperty(key: string, value: unknown): void {
    const node = this.selected
    if (!node) return
    const property = exposedProperties(node).find((p) => p.key === key)
    if (!property || property.readonly) return
    const next = this.coerce(property, value)
    if (next === undefined) return
    const before = readExposed(node, property)
    if (JSON.stringify(before) === JSON.stringify(next)) return
    const after = Array.isArray(next) ? [...next] : next
    const previous = Array.isArray(before) ? [...before] : before
    writeExposed(node, property, after)
    this.record(property.label ?? key, () => writeExposed(node, property, previous), () => writeExposed(node, property, after), `property:${this.idOf(node)}:${key}`)
    this.publishSelection()
    if (key === "active" || key === "visible") this.publishTree()
  }

  /** A `file` setting: choose a file, import it into the project's assets and point the setting at it. */
  private async pickSetting(key: string): Promise<void> {
    const field = this.recipe.settings?.fields.find((f) => f.key === key)
    if (!field || field.type !== "file") return
    const file = await pickFile(field.accept ?? "")
    if (!file || !this.folder) return
    this.writeSetting(key, await this.folder.importFile(file))
    await this.publishFiles()
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
  private coerce(property: ExposedProperty, value: unknown): unknown {
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
    if (property.type === "file") return value === null || value === "" ? null : String(value)
    if (property.type === "layers") return [...new Set(toStrings(value).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 32))].sort((a, b) => a - b)
    return String(value)
  }

  /** New nodes go under the selected node (or the root), at the orbit target in world space. A kind that needs a file asks for it first. */
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
    parent.addNode(node)
    node.transform.setWorldPosition(at ?? (this.camera.isActive ? this.camera.orbitTarget : new Vector3(0, 1, 0)))
    if (this.visualised) node.visualised = true
    this.collapsed.delete(parent)
    const index = parent.indexOf(node)
    this.record(`add ${definition.label.toLowerCase()}`, () => node.remove(), () => parent.insertNode(node, index, node.name))
    this.select(node)
  }

  /** A kind for one of the project's prefab files, named after the file. */
  private prefabKind(path: string): NodeKind | undefined {
    const prefab = this.prefabs.find((p) => p.path === path)
    if (!prefab) return undefined
    return { kind: prefab.name, label: prefab.name, cls: Prefab, make: (o) => new Prefab({ ...o, url: path }) }
  }

  private deleteSelected(): void {
    const nodes = this.selectionRoots()
    if (nodes.length === 0) return
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
    placeAll()
    this.record(nodes.length > 1 ? `move ${nodes.length} nodes` : `move ${nodes[0].name}`, putBack, placeAll)
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
const sizeOf = (node: Node3D): Vector3 | null => (isSized(node) ? new Vector3(node.width, node.height, node.depth) : null)
