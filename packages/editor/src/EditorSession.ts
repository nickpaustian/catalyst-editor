import * as THREE from "three"
import { Node3D, editorIcon, exposedProperties, readExposed, writeExposed, type Catalyst, type ExposedProperty, type NodeClass } from "@nickpaustian/catalyst"
import { Input } from "@nickpaustian/catalyst/input"
import { Physics } from "@nickpaustian/catalyst/physics"
import type { LightspeedRuntime } from "@lightspeed-js/core"
import { EditorCamera, groupTarget, type GizmoMode } from "./EditorCamera"
import { EditorInput } from "./EditorInput"
import { History } from "./History"
import { ProjectFolder, folderLoader } from "./ProjectFolder"
import type { Recipe } from "./recipe"

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

/** replace: plain click, toggle: ctrl/cmd click, range: shift click from the anchor. */
export type SelectMode = "replace" | "toggle" | "range"

export interface SelectionProperty extends ExposedProperty {
  label: string
  value: unknown
}

export type ViewMode = "orbit"

/** What the panel shows. Each key is a Lightspeed shared cell. */
export interface EditorCells {
  "editor:project": { name: string | null; recipe: string; status: string; supported: boolean; dirty: boolean }
  "editor:history": { canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null }
  "editor:view": { view: ViewMode; visualised: boolean; gizmo: GizmoMode; physics: boolean }
  "editor:tree": TreeRow[]
  "editor:kinds": { kind: string; label: string; icon: string }[]
  "editor:selection": {
    id: number
    name: string
    type: string
    icon: string
    count: number
    parent: string | null
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number }
    properties: SelectionProperty[]
  } | null
}

export type EditorCommand =
  | { type: "newProject" }
  | { type: "openFolder" }
  | { type: "reopenLast" }
  | { type: "save" }
  | { type: "saveAs" }
  | { type: "download" }
  | { type: "run" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setView"; view: ViewMode }
  | { type: "toggleVisualisers" }
  | { type: "togglePhysics" }
  | { type: "setGizmo"; mode: GizmoMode }
  | { type: "select"; id: number; mode?: SelectMode }
  | { type: "add"; kind: string }
  | { type: "toggleExpand"; id: number }
  | { type: "move"; ids: number[]; targetId: number; place: DropPlace }
  | { type: "delete" }
  | { type: "focus" }
  | { type: "setTransform"; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }
  | { type: "setProperty"; key: string; value: unknown }
  | { type: "rename"; name: string }

const round = (n: number, places = 4) => Number(n.toFixed(places))
const toStrings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : String(value ?? "").split(","))
const LIST_TYPES: ExposedProperty["type"][] = ["tags", "layers"]

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
  private _root: Node3D | null = null
  private view: ViewMode = "orbit"
  private visualised = true
  private gizmo: GizmoMode = "translate"
  private readonly history = new History()
  private dragStart: { node: Node3D; before: THREE.Matrix4 }[] | null = null
  private selected: Node3D | null = null
  private selection = new Set<Node3D>()
  private anchor: Node3D | null = null
  private ids = new Map<Node3D, number>()
  private nodesById = new Map<number, Node3D>()
  private nextId = 1
  private collapsed = new Set<Node3D>()
  private unsubscribeCommands: () => void
  private unsubscribeBlur: () => void
  private runner: Window | null = null
  private runnerReady = false
  private readonly onMessage = (event: MessageEvent): void => {
    if (event.origin !== location.origin || event.data?.type !== "vitrine:ready") return
    this.runnerReady = true
    this.sendToRunner()
  }
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === "r" && !event.shiftKey) {
      event.preventDefault()
      void this.run()
      return
    }
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
    if (key === "z" && !event.shiftKey) {
      event.preventDefault()
      this.undo()
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault()
      this.redo()
    }
  }

  constructor(options: { app: LightspeedRuntime; engine: Catalyst; recipe: Recipe }) {
    this.app = options.app
    this.engine = options.engine
    this.recipe = options.recipe
    this.camera = new EditorCamera(this.engine)
    for (const { kind, cls } of this.recipe.kinds) if (!this.engine.registry.has(kind) && typeof cls === "function") this.engine.register({ [kind]: cls as NodeClass })
    const input = this.engine.find(Input)
    this.input = input ? new EditorInput(input, { focusSelected: () => this.focusSelected(), deleteSelected: () => this.deleteSelected() }) : null
    const physics = this.engine.find(Physics)
    if (physics) physics.paused = true
    this.history.onChange = () => {
      this.publishHistory()
      this.publishProject()
    }
    this.camera.onDrag = (dragging) => (dragging ? this.beginDrag() : this.endDrag())
    this.unsubscribeCommands = this.app.shared("editor:command").subscribe((command) => {
      if (command) void this.handle(command as EditorCommand)
    })
    const pause = () => this.engine.pause()
    const resume = () => this.engine.resume()
    window.addEventListener("blur", pause)
    window.addEventListener("focus", resume)
    window.addEventListener("message", this.onMessage)
    window.addEventListener("keydown", this.onKeyDown)
    this.unsubscribeBlur = () => {
      window.removeEventListener("blur", pause)
      window.removeEventListener("focus", resume)
      window.removeEventListener("message", this.onMessage)
      window.removeEventListener("keydown", this.onKeyDown)
    }
    this.publishKinds()
    this.publishProject()
    this.publishHistory()
    this.publishView()
    this.publishTree()
    this.publishSelection()
    this.setView("orbit")
  }

  get root(): Node3D | null {
    return this._root
  }

  /** Put a project in the viewport: the folder's, or a fresh one when there is no folder. */
  async open(folder: ProjectFolder | null): Promise<void> {
    this.close()
    this.folder = folder
    this.engine.loader = folder ? folderLoader(folder) : this.engine.loader
    this.publishProject(folder ? `opening ${folder.name}` : "new project")
    const root = await this.recipe.load(folder, this.engine)
    this._root = root
    this.engine.add(root)
    this.setVisualised(this.visualised)
    this.history.clear()
    this.publishProject(folder ? "" : "unsaved")
    this.publishTree()
    this.select(null)
    this.camera.focusPoint(new THREE.Vector3(0, 0.5, 0), 8)
  }

  private close(): void {
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
    this.set("editor:kinds", this.recipe.kinds.map(({ kind, label, cls }) => ({ kind, label, icon: editorIcon(cls) })))
  }

  private publishProject(status?: string): void {
    const dirty = this.history.isDirty
    this.set("editor:project", { name: this.folder?.name ?? null, recipe: this.recipe.name, status: status ?? (dirty ? "unsaved changes" : ""), supported: ProjectFolder.isSupported, dirty })
  }

  private publishHistory(): void {
    this.set("editor:history", { canUndo: this.history.canUndo, canRedo: this.history.canRedo, undoLabel: this.history.undoLabel, redoLabel: this.history.redoLabel })
  }

  private publishView(): void {
    this.set("editor:view", { view: this.view, visualised: this.visualised, gizmo: this.gizmo, physics: !(this.engine.find(Physics)?.paused ?? true) })
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
    this.dragStart = nodes.map((node) => ({ node, before: node.transform.worldMatrix.clone() }))
  }

  private endDrag(): void {
    const start = this.dragStart
    this.dragStart = null
    if (!start || start.length === 0) return
    const moves = start.map(({ node, before }) => ({ node, before, after: node.transform.worldMatrix.clone() }))
    if (moves.every(({ before, after }) => before.equals(after))) return
    const place = (which: "before" | "after") => () => {
      for (const move of moves) move.node.transform.setWorldMatrix(move[which])
    }
    this.record(this.gizmo === "rotate" ? "rotate" : "move", place("before"), place("after"))
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
    const e = new THREE.Euler().setFromQuaternion(node.transform.rotation, "YXZ")
    this.set("editor:selection", {
      id: this.idOf(node),
      name: node.name,
      type: this.engine.registry.typeOf(node),
      icon: editorIcon(node),
      count: this.selection.size,
      parent: node.parent instanceof Node3D && node.parent !== this._root ? node.parent.name : null,
      position: { x: round(p.x), y: round(p.y), z: round(p.z) },
      rotation: { x: round(THREE.MathUtils.radToDeg(e.x), 2), y: round(THREE.MathUtils.radToDeg(e.y), 2), z: round(THREE.MathUtils.radToDeg(e.z), 2) },
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
        await this.open(null)
        break
      case "openFolder": {
        const folder = await ProjectFolder.pick()
        if (!folder) return
        await folder.remember()
        if (await folder.ensurePermission()) await this.open(folder)
        break
      }
      case "reopenLast": {
        const folder = await ProjectFolder.last()
        if (!folder) return this.publishProject("no folder remembered")
        if (await folder.ensurePermission()) await this.open(folder)
        break
      }
      case "save":
        if (this.folder) await this.save(this.folder)
        else await this.saveAs()
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
      case "setGizmo":
        this.gizmo = command.mode
        this.camera.mode = command.mode
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
    }
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
    if (this.runner && !this.runner.closed && this.runnerReady) {
      this.sendToRunner()
      this.runner.focus()
      return
    }
    this.runnerReady = false
    const url = new URL("play.html", location.href)
    url.searchParams.set("recipe", this.recipe.name)
    this.runner = window.open(url.href, "vitrine-run")
    if (!this.runner) this.publishProject("the browser blocked the runner window")
  }

  private sendToRunner(): void {
    if (!this.runner || this.runner.closed || !this._root) return
    this.runner.postMessage({ type: "vitrine:run", recipe: this.recipe.name, scene: this.engine.serialise(this._root), folder: this.folder?.handle ?? null }, location.origin)
    this.publishProject("running")
  }

  private async save(folder: ProjectFolder): Promise<void> {
    if (!this._root) return
    const written = await this.recipe.save(folder, this._root, this.engine)
    this.history.markSaved()
    this.publishProject(`saved ${written.join(", ")}`)
  }

  private async saveAs(): Promise<void> {
    if (!ProjectFolder.isSupported) {
      const file = this._root && this.recipe.download?.(this._root, this.engine)
      if (file) download(file.name, file.text)
      return
    }
    const folder = await ProjectFolder.pick()
    if (!folder) return
    await folder.remember()
    if (!(await folder.ensurePermission())) return
    this.folder = folder
    this.engine.loader = folderLoader(folder)
    await this.save(folder)
  }

  //=========================
  // View
  //=========================

  private setView(view: ViewMode): void {
    this.view = view
    this.camera.activate()
    this.input?.activate()
    if (this.selected) this.attachGizmo(this.selected)
    this.publishView()
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
    const centre = new THREE.Vector3()
    for (const node of this.selection) centre.add(node.transform.getWorldPosition())
    this.camera.focusPoint(centre.divideScalar(this.selection.size))
  }

  //=========================
  // Editing
  //=========================

  private writeTransform(position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }): void {
    const node = this.selected
    if (!node) return
    const before = { position: node.transform.position.clone(), rotation: node.transform.rotation.clone() }
    const after = { position: new THREE.Vector3(position.x, position.y, position.z), rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(rotation.x), THREE.MathUtils.degToRad(rotation.y), THREE.MathUtils.degToRad(rotation.z), "YXZ")) }
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
    let next: unknown = value
    if (property.type === "number") {
      next = Number(value)
      if (!Number.isFinite(next)) return
      if (property.min !== undefined) next = Math.max(property.min, next as number)
      if (property.max !== undefined) next = Math.min(property.max, next as number)
    } else if (property.type === "boolean") next = Boolean(value)
    else if (property.type === "colour") {
      next = typeof value === "string" ? parseInt(value.replace("#", ""), 16) : Number(value)
      if (!Number.isFinite(next)) return
    }
    else if (property.type === "tags") next = [...new Set(toStrings(value).map((tag) => tag.trim()).filter(Boolean))]
    else if (property.type === "layers") next = [...new Set(toStrings(value).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < 32))].sort((a, b) => a - b)
    else next = String(value)
    const before = readExposed(node, property)
    if (JSON.stringify(before) === JSON.stringify(next)) return
    const after = Array.isArray(next) ? [...next] : next
    const previous = Array.isArray(before) ? [...before] : before
    writeExposed(node, property, after)
    this.record(property.label ?? key, () => writeExposed(node, property, previous), () => writeExposed(node, property, after), `property:${this.idOf(node)}:${key}`)
    this.publishSelection()
    if (key === "active" || key === "visible") this.publishTree()
  }

  /** New nodes go under the selected node (or the root), at the orbit target in world space. */
  private addNode(kind: string): void {
    const parent = this.selected ?? this._root
    const definition = this.recipe.kinds.find((k) => k.kind === kind)
    if (!parent || !definition) return
    const node = definition.make({ name: `${kind.charAt(0).toLowerCase()}${kind.slice(1)}`, visualise: this.visualised })
    parent.addNode(node)
    node.transform.setWorldPosition(this.camera.isActive ? this.camera.orbitTarget : new THREE.Vector3(0, 1, 0))
    if (this.visualised) node.visualised = true
    this.collapsed.delete(parent)
    const index = parent.indexOf(node)
    this.record(`add ${definition.label.toLowerCase()}`, () => node.remove(), () => parent.insertNode(node, index, node.name))
    this.select(node)
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
    for (const node of nodes) {
      if (node.parent !== newParent && newParent.children.has(node.name)) return this.publishProject(`"${node.name}" already exists under ${newParent.name}`)
    }
    const before = nodes.map((node) => ({ node, parent: node.parent as Node3D, index: (node.parent as Node3D).indexOf(node), world: node.transform.worldMatrix.clone() }))
    const placeAll = () => {
      for (const node of nodes) node.remove()
      let index = place === "inside" ? newParent.children.size : newParent.indexOf(target) + (place === "after" ? 1 : 0)
      for (const { node, world } of before) {
        newParent.insertNode(node, index++, node.name)
        node.transform.setWorldMatrix(world)
      }
    }
    const putBack = () => {
      for (const { node } of before) node.remove()
      for (const { node, parent, index, world } of [...before].sort((a, b) => a.index - b.index)) {
        parent.insertNode(node, index, node.name)
        node.transform.setWorldMatrix(world)
      }
    }
    placeAll()
    this.record(nodes.length > 1 ? `move ${nodes.length} nodes` : `move ${nodes[0].name}`, putBack, placeAll)
    this.collapsed.delete(newParent)
    this.camera.syncFromTarget()
    this.publishTree()
    this.publishSelection()
  }
}
