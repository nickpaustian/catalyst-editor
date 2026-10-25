import type { FileInfo, FolderEntry, FolderTransfer, ProjectFolder, ProjectStorage } from "./ProjectFolder"

export const ASSET_TABLE = ".assets.json"
/** Where the table was before; ids only it knows still load, and are written into the table with its next change. */
const LEGACY_ASSET_TABLE = ".catalyst/assets.json"
const ASSET_PREFIX = "asset:"
const ID_PATTERN = /^asset:[0-9a-f-]{36}$/
const FILE_PATH = /^[^:?#\s][^:?#]*\.[A-Za-z0-9]{1,10}$/
/** Folders that stand as one asset, named by an extension as a file is. */
const PACKAGE = /\.theca$/i
const NOT_REFERENCES = new Set(["name", "type"])
const SKIPPED_DIRS = new Set(["node_modules", ".git"])
const HASHED_UP_TO = 32 * 1024 * 1024
const PREVIOUS_KEPT = 8

interface AssetEntry {
  path: string
  size: number
  /** SHA-256 of the contents, for files small enough to read whole; null for larger ones and for packages. */
  hash: string | null
  /** Where the file was before, newest first, so names saved before a move still load. */
  previous?: string[]
}

interface AssetTableJSON {
  version: 1
  assets: Record<string, AssetEntry>
}

/** A file the table found again under another name after it moved outside the editor. */
export interface Relinked {
  from: string
  to: string
}

const extensionOf = (path: string): string => path.slice(path.lastIndexOf(".")).toLowerCase()

const isUnder = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`)

const hashOf = async (file: Blob): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/** Every string in a JSON value passed through `map`, except node names and types. */
const mapStrings = async (value: unknown, map: (text: string) => string | Promise<string>, key = ""): Promise<unknown> => {
  if (typeof value === "string") return NOT_REFERENCES.has(key) ? value : map(value)
  if (Array.isArray(value)) return Promise.all(value.map((item) => mapStrings(item, map)))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = await mapStrings(v, map, k)
    return out
  }
  return value
}

/**
 * A project folder whose saved JSON names files by id. The ids and the
 * paths they stand for live in `.assets.json`; a file is given one
 * the first time a saved scene or prefab names it. Reads give back paths,
 * so the engine and the editor only ever see paths; a rename through this
 * folder moves the path an id stands for, and the old path keeps loading.
 * Files moved by other programs are found again by size and contents.
 */
export class AssetFolder implements ProjectFolder {
  readonly raw: ProjectFolder
  private table: AssetTableJSON = { version: 1, assets: {} }
  private byPath = new Map<string, string>()
  private byPrevious = new Map<string, string>()

  private constructor(raw: ProjectFolder) {
    this.raw = raw
  }

  /** Wrap a folder and read its table; an AssetFolder is given back as it is. */
  static async open(folder: ProjectFolder): Promise<AssetFolder> {
    if (folder instanceof AssetFolder) return folder
    const wrapped = new AssetFolder(folder)
    await wrapped.readTable()
    return wrapped
  }

  get name(): string {
    return this.raw.name
  }

  get storage(): ProjectStorage {
    return this.raw.storage
  }

  //=========================
  // Ids and paths
  //=========================

  /** The path a saved name stands for now: an id's path, or where a moved file went; anything else as it is. */
  current(path: string): string {
    if (ID_PATTERN.test(path)) return this.table.assets[path.slice(ASSET_PREFIX.length)]?.path ?? path
    if (this.byPath.has(path)) return path
    const id = this.byPrevious.get(path)
    return id ? this.table.assets[id].path : path
  }

  /** As `current`, but an old path that a file now answers to again is that file. */
  private async resolve(path: string): Promise<string> {
    const now = this.current(path)
    if (now === path || ID_PATTERN.test(path)) return now
    return (await this.present(path)) ? path : now
  }

  /** Whether a file, or a package folder, is at a path: some folders answer `exists` only for files. */
  private async present(path: string): Promise<boolean> {
    if (await this.raw.exists(path).catch(() => false)) return true
    return PACKAGE.test(path) && (await this.raw.list(path).then(() => true, () => false))
  }

  /** Every id in a JSON value turned into its path, and every old path into the new one. */
  toPaths<T>(value: T): Promise<T> {
    return mapStrings(value, (text) => this.resolve(text)) as Promise<T>
  }

  /** Every path in a JSON value that names a file in the project turned into its id, giving new files one. */
  async toIds<T>(value: T): Promise<T> {
    const before = JSON.stringify(this.table)
    const known = new Map<string, boolean>()
    const exists = async (path: string) => {
      if (!known.has(path)) known.set(path, await this.present(path))
      return known.get(path)!
    }
    const out = (await mapStrings(value, async (text) => {
      const path = await this.resolve(text)
      const id = this.byPath.get(path)
      if (id) return ASSET_PREFIX + id
      if (!FILE_PATH.test(path) || !(await exists(path))) return text
      return ASSET_PREFIX + (await this.track(path))
    })) as T
    if (JSON.stringify(this.table) !== before) await this.writeTable()
    return out
  }

  private async track(path: string): Promise<string> {
    const id = crypto.randomUUID()
    if (PACKAGE.test(path) && (await this.raw.list(path).then(() => true, () => false))) {
      this.table.assets[id] = { path, size: 0, hash: null }
    } else {
      const file = await this.raw.readFile(path)
      this.table.assets[id] = { path, size: file.size, hash: file.size <= HASHED_UP_TO ? await hashOf(file) : null }
    }
    for (const entry of Object.values(this.table.assets)) if (entry.previous?.includes(path)) entry.previous = entry.previous.filter((p) => p !== path)
    this.index()
    return id
  }

  /** The path an id stood for moves with a rename: a file's own, or every file under a renamed folder. */
  private moved(from: string, to: string): void {
    for (const entry of Object.values(this.table.assets)) {
      if (!isUnder(entry.path, from)) continue
      const was = entry.path
      entry.path = to + was.slice(from.length)
      entry.previous = [was, ...(entry.previous ?? []).filter((p) => p !== entry.path && p !== was)].slice(0, PREVIOUS_KEPT)
    }
    this.index()
  }

  /**
   * Find files the table names that are no longer where it says, among the
   * project's other files: the same size and extension, and the same
   * contents where the file was small enough to hash. Only a single match
   * is taken. Gives back what moved.
   */
  async relink(): Promise<Relinked[]> {
    const missing: AssetEntry[] = []
    for (const entry of Object.values(this.table.assets)) if (!PACKAGE.test(entry.path) && !(await this.present(entry.path))) missing.push(entry)
    if (!missing.length) return []
    const extensions = new Set(missing.map((entry) => extensionOf(entry.path)))
    const candidates: { path: string; size: number }[] = []
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await this.raw.list(dir).catch(() => [] as FolderEntry[])) {
        if (entry.kind === "directory") {
          if (!SKIPPED_DIRS.has(entry.name)) await walk(entry.path)
        } else if (extensions.has(extensionOf(entry.path)) && !this.byPath.has(entry.path)) {
          candidates.push({ path: entry.path, size: (await this.raw.stat(entry.path)).size })
        }
      }
    }
    await walk("")
    const relinked: Relinked[] = []
    for (const entry of missing) {
      let matches = candidates.filter((c) => c.size === entry.size && extensionOf(c.path) === extensionOf(entry.path))
      if (entry.hash && matches.length) {
        const hashed = await Promise.all(matches.map(async (c) => ((await hashOf(await this.raw.readFile(c.path))) === entry.hash ? c : null)))
        matches = hashed.filter((c): c is { path: string; size: number } => c !== null)
      }
      if (matches.length !== 1) continue
      const to = matches[0].path
      relinked.push({ from: entry.path, to })
      candidates.splice(candidates.indexOf(matches[0]), 1)
      entry.previous = [entry.path, ...(entry.previous ?? []).filter((p) => p !== to)].slice(0, PREVIOUS_KEPT)
      entry.path = to
    }
    if (relinked.length) {
      this.index()
      await this.writeTable()
    }
    return relinked
  }

  /** The table's paths that no file answers to now. */
  async missing(): Promise<string[]> {
    const out: string[] = []
    for (const entry of Object.values(this.table.assets)) if (!(await this.present(entry.path))) out.push(entry.path)
    return out
  }

  /** Whether a path is one the table holds an id for. */
  tracks(path: string): boolean {
    return this.byPath.has(path)
  }

  private index(): void {
    this.byPath = new Map()
    for (const [id, entry] of Object.entries(this.table.assets)) if (!this.byPath.has(entry.path)) this.byPath.set(entry.path, id)
    this.byPrevious = new Map()
    for (const [id, entry] of Object.entries(this.table.assets)) for (const path of entry.previous ?? []) if (!this.byPath.has(path) && !this.byPrevious.has(path)) this.byPrevious.set(path, id)
  }

  private async readTable(): Promise<void> {
    const assets = { ...(await this.readAssets(ASSET_TABLE)) }
    for (const [id, entry] of Object.entries(await this.readAssets(LEGACY_ASSET_TABLE))) assets[id] ??= entry
    this.table = { version: 1, assets }
    this.index()
  }

  private async readAssets(path: string): Promise<AssetTableJSON["assets"]> {
    if (!(await this.raw.exists(path).catch(() => false))) return {}
    const json = await this.raw.readJSON<Partial<AssetTableJSON>>(path).catch(() => null)
    return json?.assets && typeof json.assets === "object" ? json.assets : {}
  }

  private writeTable(): Promise<void> {
    return this.raw.writeJSON(ASSET_TABLE, this.table)
  }

  //=========================
  // The folder
  //=========================

  remember(): Promise<void> {
    return this.raw.remember()
  }

  ensurePermission(): Promise<boolean> {
    return this.raw.ensurePermission()
  }

  async exists(path: string): Promise<boolean> {
    return this.raw.exists(await this.resolve(path))
  }

  async readFile(path: string): Promise<File> {
    return this.raw.readFile(await this.resolve(path))
  }

  async readRange(path: string, start: number, end: number): Promise<Blob> {
    const resolved = await this.resolve(path)
    return this.raw.readRange ? this.raw.readRange(resolved, start, end) : (await this.raw.readFile(resolved)).slice(start, end)
  }

  async readText(path: string): Promise<string> {
    return this.raw.readText(await this.resolve(path))
  }

  async readJSON<T = unknown>(path: string): Promise<T> {
    const json = await this.raw.readJSON<T>(await this.resolve(path))
    return path === ASSET_TABLE ? json : this.toPaths(json)
  }

  writeText(path: string, text: string): Promise<void> {
    return this.raw.writeText(path, text)
  }

  /** JSON files are saved with ids for the files they name; others (the project file) as they are. */
  async writeJSON(path: string, value: unknown): Promise<void> {
    return this.raw.writeJSON(path, path.endsWith(".json") && path !== ASSET_TABLE ? await this.toIds(value) : value)
  }

  writeFile(path: string, data: Blob | ArrayBuffer): Promise<void> {
    return this.raw.writeFile(path, data)
  }

  importFile(file: File, dir?: string): Promise<string> {
    return this.raw.importFile(file, dir)
  }

  async stat(path: string): Promise<FileInfo> {
    return this.raw.stat(await this.resolve(path))
  }

  mkdir(path: string): Promise<void> {
    return this.raw.mkdir(path)
  }

  remove(path: string): Promise<void> {
    return this.raw.remove(path)
  }

  async rename(from: string, to: string): Promise<void> {
    await this.raw.rename(from, to)
    if (![...this.byPath.keys()].some((path) => isUnder(path, from))) return
    this.moved(from, to)
    await this.writeTable()
  }

  list(dir?: string): Promise<FolderEntry[]> {
    return this.raw.list(dir)
  }

  clear(): Promise<void> {
    this.table = { version: 1, assets: {} }
    this.index()
    return this.raw.clear()
  }

  transfer(): FolderTransfer {
    return this.raw.transfer()
  }

  get watch(): ProjectFolder["watch"] {
    return this.raw.watch ? (listener) => this.raw.watch!(listener) : undefined
  }
}
