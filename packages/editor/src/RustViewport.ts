import { Node3D, type Catalyst, type ExposedProperty, type Material, type Node, type Visual } from "@nickpaustian/catalyst"
import { LineSet, type Mesh } from "@nickpaustian/obelisk"
import type { EditorCamera } from "./EditorCamera"

type RustModule = typeof import("@nickpaustian/catalyst-rs")
type RustEngine = import("@nickpaustian/catalyst-rs").Engine
type RustViewportSurface = import("@nickpaustian/catalyst-rs").Viewport

/** A kind as the Rust table describes it: the inspector's metadata on each property, `shownWhen` as a key and the value it must hold. */
interface KindInfo {
  base?: string
  icon?: string
  properties?: (ExposedProperty & { shownWhen?: { key: string; is: unknown } })[]
}

/** What the Rust engine says of a node: its kind's exposed properties, the inspector's way, and their values now. */
export interface RustInspection {
  properties: ExposedProperty[]
  values: Record<string, unknown>
}

let loading: Promise<RustModule | null> | null = null

/** The wasm engine, when the package is linked (`npm run link:rust`); null when it is not. */
export const loadRustEngine = (): Promise<RustModule | null> => {
  loading ??= import("@nickpaustian/catalyst-rs")
    .then(async (module) => {
      await module.default()
      return module
    })
    .catch((error: unknown) => {
      console.warn(`[editor] the Rust engine is not available: ${error instanceof Error ? error.message : error}`)
      loading = null
      return null
    })
  return loading
}

export interface RustViewportOptions {
  engine: Catalyst
  camera: EditorCamera
  container: HTMLElement
  background: number
  /** The children a scene file holds, in order: the ones the engine's `serialise` writes. */
  childrenOf: (node: Node) => Node[]
}

/**
 * The editor's viewport drawn by the Rust engine: the open scene mirrored into
 * the wasm engine, drawn on a canvas under the editor's own, which keeps the
 * pointer for the camera, the gizmo and the marquee. Structure follows each
 * edit the session commits; transforms follow every frame, so a drag shows as
 * it goes. Picking asks the Rust side, so a click proves the mirror lines up.
 */
export class RustViewport {
  private module: RustModule | null = null
  private engine: RustEngine | null = null
  private surface: RustViewportSurface | null = null
  private readonly canvas: HTMLCanvasElement
  private readonly options: RustViewportOptions
  private root: Node | null = null
  private level: number | null = null
  private stale = true
  private _active = false
  private readonly idsByNode = new Map<Node, number>()
  private readonly nodesById = new Map<number, Node>()
  private readonly written = new Map<number, number[]>()
  private readonly fetching = new Set<string>()
  private readonly failed = new Set<string>()
  private observer: ResizeObserver | null = null
  private warnedMismatch = false
  /** The loose visuals' geometry as uploaded: the TypeScript mesh or line set, its version then, and the last frame it was drawn. */
  private readonly helperGeometry = new Map<Mesh | LineSet, { id: number; version: number; overlay: boolean; seen: number }>()
  private readonly helperMaterials = new Map<string, { slot: number; seen: number }>()
  private frameCount = 0
  private helperRecords = new Float32Array(0)
  private kinds: Record<string, KindInfo> | null = null

  constructor(options: RustViewportOptions) {
    this.options = options
    this.canvas = document.createElement("canvas")
    this.canvas.className = "rust-viewport"
    this.canvas.hidden = true
    options.container.prepend(this.canvas)
  }

  get active(): boolean {
    return this._active
  }

  /** Whether the Rust engine could be loaded; false means the package is not linked. */
  async available(): Promise<boolean> {
    this.module ??= await loadRustEngine()
    return this.module !== null
  }

  /** Draw through the Rust engine, or stop and show the TypeScript engine's canvas again. */
  async setActive(on: boolean): Promise<boolean> {
    if (on === this._active) return on
    if (on) {
      if (!(await this.available())) return false
      if (!this.surface) await this.mount()
      if (!this.surface) return false
      this._active = true
      this.canvas.hidden = false
      this.options.engine.canvas?.classList.add("behind-rust")
      this.stale = true
    } else {
      this._active = false
      this.canvas.hidden = true
      this.options.engine.canvas?.classList.remove("behind-rust")
    }
    return this._active
  }

  private async mount(): Promise<void> {
    const module = this.module!
    const rect = this.options.container.getBoundingClientRect()
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio))
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio))
    this.canvas.hidden = false
    try {
      this.engine = new module.Engine()
      this.surface = await module.create_viewport(this.canvas, this.options.background, 4)
    } catch (error) {
      console.warn(`[editor] the Rust viewport could not start: ${error instanceof Error ? error.message : error}`)
      this.canvas.hidden = true
      this.engine = null
      this.surface = null
      return
    }
    this.surface.set_host_camera(true)
    this.observer = new ResizeObserver(() => this.fit())
    this.observer.observe(this.options.container)
  }

  private fit(): void {
    if (!this.surface) return
    const rect = this.options.container.getBoundingClientRect()
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(rect.width * ratio))
    const height = Math.max(1, Math.round(rect.height * ratio))
    if (width === this.canvas.width && height === this.canvas.height) return
    this.canvas.width = width
    this.canvas.height = height
    this.surface.resize(width, height)
  }

  /** The scene the editor has open; null closes it. */
  setRoot(root: Node | null): void {
    this.root = root
    this.stale = true
  }

  /** The scene's structure or properties changed: rebuild on the next frame. */
  invalidate(): void {
    this.stale = true
  }

  /** Each editor frame: the mirror catches up and draws under the editor camera. */
  frame(dt: number): void {
    if (!this._active || !this.engine || !this.surface) return
    if (this.stale) this.rebuild()
    this.syncTransforms()
    this.syncHelpers()
    const camera = this.options.camera
    const pose = JSON.stringify({ position: [camera.position.x, camera.position.y, camera.position.z], rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z, camera.rotation.w], fov: camera.fov, near: camera.near, far: camera.far })
    try {
      this.surface.render(this.engine, dt, false, pose)
    } catch (error) {
      console.warn(`[editor] the Rust viewport failed to draw: ${error instanceof Error ? error.message : error}`)
      void this.setActive(false)
      return
    }
    this.fetchMissing()
  }

  /**
   * The editor's helpers, drawn by the Rust side too: every visual in the TypeScript scene list that no node
   * owns (the gizmo, the grid, ghosts, handles, outlines), its geometry uploaded once and again when its
   * version moves, placed each frame with its matrix and a flat material in the visual's colour.
   */
  private syncHelpers(): void {
    const engine = this.engine!
    const surface = this.surface!
    this.frameCount++
    const owned = new Set<Visual>()
    this.root?.walk((node) => {
      if (node instanceof Node3D) for (const visual of node.attachedObjects) owned.add(visual)
    })
    const records: number[] = []
    for (const visual of this.options.engine.scene.all) {
      if (!visual.visible || owned.has(visual)) continue
      const geometry = visual.geometry
      let entry = this.helperGeometry.get(geometry)
      const isLines = geometry instanceof LineSet
      if (!entry) {
        const id = isLines ? surface.upload_lines(geometry.positions, geometry.colours, geometry.overlay) : surface.upload_mesh(geometry.vertices, geometry.normals, geometry.indices)
        entry = { id, version: geometry.version, overlay: isLines && geometry.overlay, seen: 0 }
        this.helperGeometry.set(geometry, entry)
      } else if (entry.version !== geometry.version || (isLines && entry.overlay !== geometry.overlay)) {
        if (isLines) surface.update_lines(entry.id, geometry.positions, geometry.colours, geometry.overlay)
        else surface.update_mesh(entry.id, geometry.vertices, geometry.normals, geometry.indices)
        entry.version = geometry.version
        entry.overlay = isLines && geometry.overlay
      }
      entry.seen = this.frameCount
      const material = isLines ? -1 : this.helperMaterial(visual.material)
      records.push(isLines ? 1 : 0, entry.id, material, visual.overlay ? 1 : 0, visual.order, ...visual.matrix.data)
    }
    for (const [geometry, entry] of this.helperGeometry) {
      if (this.frameCount - entry.seen < 120) continue
      if (geometry instanceof LineSet) surface.release_lines(entry.id)
      else surface.release_mesh(entry.id)
      this.helperGeometry.delete(geometry)
    }
    for (const [key, entry] of this.helperMaterials) {
      if (this.frameCount - entry.seen < 120) continue
      surface.release_material(engine, entry.slot)
      this.helperMaterials.delete(key)
    }
    if (this.helperRecords.length !== records.length) this.helperRecords = new Float32Array(records.length)
    this.helperRecords.set(records)
    surface.set_helpers(this.helperRecords)
  }

  /** A flat material on the Rust side matching a helper's colour, coverage and lighting; -1 lets the mesh's parts name their own. */
  private helperMaterial(material: Material | null): number {
    if (!material) return -1
    const key = `${material.colour}/${material.opacity}/${material.unlit ? 1 : 0}`
    let entry = this.helperMaterials.get(key)
    if (!entry) {
      entry = { slot: this.surface!.add_material(this.engine!, material.colour, material.opacity, material.unlit), seen: 0 }
      this.helperMaterials.set(key, entry)
    }
    entry.seen = this.frameCount
    return entry.slot
  }

  /**
   * The exposed properties of a node's kind as the Rust engine declares them, base kinds first, with the values the
   * Rust node holds; null for a kind the Rust engine does not own, which the TypeScript node then describes itself.
   */
  inspect(node: Node): RustInspection | null {
    if (!this._active || !this.engine || !this.surface) return null
    if (this.stale) this.rebuild()
    const id = this.idsByNode.get(node)
    if (id === undefined) return null
    this.kinds ??= JSON.parse(this.engine.kind_properties()) as Record<string, KindInfo>
    const chain: KindInfo[] = []
    for (let kind = this.engine.node_kind(id); kind && this.kinds[kind]; kind = this.kinds[kind].base) chain.unshift(this.kinds[kind])
    if (chain.length === 0) return null
    const values: Record<string, unknown> = {}
    const properties: ExposedProperty[] = []
    for (const info of chain) {
      for (const { shownWhen, ...property } of info.properties ?? []) {
        if (property.hidden) continue
        values[property.key] = JSON.parse(this.engine.get_property(id, property.key))
        properties.push(shownWhen ? { ...property, shownWhen: () => values[shownWhen.key] === shownWhen.is } : property)
      }
    }
    return { properties, values }
  }

  /** The node under a point of the view, by the Rust engine's own picking. */
  pick(x: number, y: number): Node3D | null {
    if (!this._active || !this.engine || !this.surface) return null
    const rect = this.canvas.getBoundingClientRect()
    const hit = JSON.parse(this.surface.pick(this.engine, (x - rect.left) / rect.width, (y - rect.top) / rect.height)) as { id: number } | null
    if (!hit) return null
    const node = this.nodeFor(hit.id)
    return node instanceof Node3D ? node : null
  }

  /** The scene node a Rust node belongs to: itself, or the nearest owner above a prefab's internals. */
  private nodeFor(id: number): Node | null {
    for (let at: number | undefined = id; at !== undefined && at !== this.engine!.root(); ) {
      const node = this.nodesById.get(at)
      if (node) return node
      at = this.parentOf(at)
    }
    return null
  }

  private parentOf(id: number): number | undefined {
    for (const [candidate] of this.nodesById) if (Array.from(this.engine!.children_of(candidate)).includes(id)) return candidate
    return undefined
  }

  private rebuild(): void {
    const engine = this.engine!
    this.stale = false
    this.kinds = null
    if (this.level !== null) {
      engine.free_node(this.level)
      this.level = null
    }
    this.idsByNode.clear()
    this.nodesById.clear()
    this.written.clear()
    if (!this.root) return
    const json = this.options.engine.serialise(this.root)
    try {
      this.level = engine.create_tree(JSON.stringify(json))
    } catch (error) {
      console.warn(`[editor] the Rust engine could not take the scene: ${error instanceof Error ? error.message : error}`)
      return
    }
    engine.add_node(engine.root(), this.level, undefined, -1)
    this.map(this.root, this.level)
    this.surface!.apply_environment(engine)
    this.surface!.retry_assets(engine)
  }

  /** Pair each scene node with the Rust node made from it, in the order both hold their children. */
  private map(node: Node, id: number): void {
    this.idsByNode.set(node, id)
    this.nodesById.set(id, node)
    const children = this.options.childrenOf(node)
    const made = Array.from(this.engine!.children_of(id)).filter((child) => !this.engine!.is_internal(child))
    if (children.length !== made.length && !this.warnedMismatch) {
      this.warnedMismatch = true
      console.warn(`[editor] the Rust engine made ${made.length} children of ${node.name} for the editor's ${children.length}`)
    }
    children.forEach((child, i) => {
      if (i < made.length) this.map(child, made[i])
    })
  }

  private syncTransforms(): void {
    const engine = this.engine!
    for (const [node, id] of this.idsByNode) {
      if (!(node instanceof Node3D)) continue
      const { position: p, rotation: q, scale: s } = node.transform
      const next = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z]
      const last = this.written.get(id)
      if (last && last.every((value, i) => value === next[i])) continue
      this.written.set(id, next)
      engine.set_local(id, next[0], next[1], next[2], next[3], next[4], next[5], next[6], next[7], next[8], next[9])
    }
  }

  /** Files the scene names, read through the editor engine's loader, which knows the project's asset table. */
  private fetchMissing(): void {
    for (const url of this.surface!.missing_files()) {
      if (this.fetching.has(url) || this.failed.has(url)) continue
      this.fetching.add(url)
      this.options.engine.loader
        .arrayBuffer(url)
        .then((buffer) => {
          this.surface?.provide_file(url, new Uint8Array(buffer))
          if (this.engine) this.surface?.retry_assets(this.engine)
        })
        .catch((error: unknown) => {
          this.failed.add(url)
          console.warn(`[editor] ${url}: ${error instanceof Error ? error.message : error}`)
        })
        .finally(() => this.fetching.delete(url))
    }
  }

  dispose(): void {
    void this.setActive(false)
    this.observer?.disconnect()
    this.surface?.free()
    this.engine?.free()
    this.surface = null
    this.engine = null
    this.canvas.remove()
  }
}
