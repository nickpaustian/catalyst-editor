import { fetchLoader, type Loader } from "@nickpaustian/catalyst"
import { readProjectImage, readProjectSettings, slug } from "./project"
import { acceptedExtensions } from "./fileField"

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>
  }
}

export type ProjectStorage = "disk" | "browser" | "native"

export interface FolderEntry {
  path: string
  name: string
  kind: "file" | "directory"
}

export interface FileInfo {
  size: number
  modified: number
}

const parentOf = (path: string): string => path.replace(/\/?[^/]*$/, "")

/** What a folder sends to another window (the runner) so it can open the same project. */
export type FolderTransfer = { kind: "handle"; handle: FileSystemDirectoryHandle } | { kind: "path"; path: string }

/**
 * A project: files read and written by path under one folder. On disk
 * through the File System Access API, in the browser's own storage, or
 * through a native filesystem when the editor runs in a desktop shell.
 */
export interface ProjectFolder {
  readonly name: string
  readonly storage: ProjectStorage
  remember(): Promise<void>
  ensurePermission(): Promise<boolean>
  exists(path: string): Promise<boolean>
  readFile(path: string): Promise<File>
  /** Bytes `start` to `end` (exclusive) of a file, where reading only those is cheaper than `readFile`. */
  readRange?(path: string, start: number, end: number): Promise<Blob>
  readText(path: string): Promise<string>
  readJSON<T = unknown>(path: string): Promise<T>
  writeText(path: string, text: string): Promise<void>
  writeJSON(path: string, value: unknown): Promise<void>
  writeFile(path: string, data: Blob | ArrayBuffer): Promise<void>
  /** Copy a file the user chose into the project, under `dir`, and give back its path; a name clash gets a number. */
  importFile(file: File, dir?: string): Promise<string>
  /** A file's size in bytes and when it was last changed, in ms since the epoch. */
  stat(path: string): Promise<FileInfo>
  /** Make a folder, and the folders above it. */
  mkdir(path: string): Promise<void>
  /** Delete a file, or a folder and everything in it. */
  remove(path: string): Promise<void>
  /** Move a file or folder; the folders above `to` are made. */
  rename(from: string, to: string): Promise<void>
  /** The entries directly under a directory, with their paths. */
  list(dir?: string): Promise<FolderEntry[]>
  /** Remove everything in the project. */
  clear(): Promise<void>
  transfer(): FolderTransfer
  /** Hear about files changed by something other than this folder, as relative paths; where the host can watch. */
  watch?(listener: (paths: string[]) => void): Promise<() => void>
}

/** A project opened before, as the start screen lists it. */
export interface RecentProject {
  id: string
  name: string
  /** Where it lives, for the eye: a path (home shown as `~`), or "in the browser". */
  location: string
  storage: ProjectStorage
  /** Its folder is gone: moved or deleted since it was opened. */
  missing?: boolean
  /** When it was last opened, in ms since the epoch, where that is known. */
  opened?: number
  /** Its picture as a data url, when it has one. */
  image?: string | null
}

/** Where projects come from: the browser's pickers and storage, or a desktop shell's. */
export interface FolderSource {
  /** Whether folders on disk can be opened. */
  readonly isSupported: boolean
  /** Whether projects can live in the browser's own storage. */
  readonly hasBrowserStorage: boolean
  pick(): Promise<ProjectFolder | null>
  last(): Promise<ProjectFolder | null>
  inBrowser(name: string): Promise<ProjectFolder>
  browserProjects(): Promise<string[]>
  fromTransfer(transfer: FolderTransfer): ProjectFolder
  /** Whether projects are made in a chosen location (folders), rather than in the browser. */
  readonly hasLocations: boolean
  /** Ask for a parent folder for a new project; null when cancelled or where there are no locations. */
  pickLocation(): Promise<string | null>
  /** Where a new project goes unless another is chosen: the last location used, else Documents, else nothing until one is picked. */
  defaultLocation(): Promise<string | null>
  /** Whether a new project of that name would land on a folder that already exists. */
  isTaken(name: string, location: string | null): Promise<boolean>
  /** Make a project's folder: named after the project under `location`, or in the browser. */
  create(name: string, location: string | null): Promise<ProjectFolder>
  /** Whether a git repository can be started in a project's folder. */
  readonly canInitGit: boolean
  initGit(folder: ProjectFolder): Promise<void>
  /** Projects opened before, most recent first. */
  recent(): Promise<RecentProject[]>
  openRecent(id: string): Promise<ProjectFolder | null>
  forget(id: string): Promise<void>
}

const HANDLE_DB = "catalyst-editor"
const HANDLE_STORE = "handles"
const HANDLE_KEY = "last-folder"
const BROWSER_PROJECTS = "projects"

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(HANDLE_STORE, mode).objectStore(HANDLE_STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** The name the project's file gives it, or the folder's own when there is none, and its picture. */
const projectCard = async (folder: ProjectFolder): Promise<{ name: string; image: string | null }> => {
  const settings = await readProjectSettings(folder)
  return { name: settings?.name ?? folder.name, image: await readProjectImage(folder, settings) }
}

const importPath = async (folder: ProjectFolder, file: File, dir: string): Promise<string> => {
  const base = file.name.replace(/[^\w.-]+/g, "-")
  const dot = base.lastIndexOf(".")
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ""
  let path = `${dir}/${base}`
  for (let n = 2; await folder.exists(path); n++) path = `${dir}/${stem}-${n}${ext}`
  return path
}

/**
 * A project behind a `FileSystemDirectoryHandle`: a folder the user picked
 * through the File System Access API (Chromium), or one in the origin
 * private file system, which every current browser has. The last picked
 * folder is remembered across reloads, though the browser asks for a click
 * before giving it back.
 */
const POLL_MS = 2000
const POLLED_DIRS = ["", "scripts", "prefabs"]

export class HandleFolder implements ProjectFolder {
  readonly handle: FileSystemDirectoryHandle
  readonly storage: ProjectStorage
  private readonly written = new Map<string, number>()

  constructor(handle: FileSystemDirectoryHandle, storage: ProjectStorage = "disk") {
    this.handle = handle
    this.storage = storage
  }

  get name(): string {
    return this.handle.name
  }

  static get isSupported(): boolean {
    return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function"
  }

  static get hasBrowserStorage(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function"
  }

  /** A project kept by the browser, made if need be. Nothing on disk; import files into it and export it out. */
  static async inBrowser(name: string): Promise<HandleFolder> {
    const root = await navigator.storage.getDirectory()
    const projects = await root.getDirectoryHandle(BROWSER_PROJECTS, { create: true })
    return new HandleFolder(await projects.getDirectoryHandle(name, { create: true }), "browser")
  }

  static async browserProjects(): Promise<string[]> {
    if (!HandleFolder.hasBrowserStorage) return []
    const root = await navigator.storage.getDirectory()
    const projects = await root.getDirectoryHandle(BROWSER_PROJECTS, { create: true })
    const names: string[] = []
    for await (const [name, entry] of projects as unknown as AsyncIterable<[string, FileSystemHandle]>) if (entry.kind === "directory") names.push(name)
    return names.sort()
  }

  static async pick(): Promise<HandleFolder | null> {
    if (!window.showDirectoryPicker) return null
    try {
      return new HandleFolder(await window.showDirectoryPicker({ mode: "readwrite", id: "catalyst-project" }))
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return null
      throw error
    }
  }

  async remember(): Promise<void> {
    await withStore("readwrite", (store) => store.put(this.handle, HANDLE_KEY))
  }

  static async last(): Promise<HandleFolder | null> {
    try {
      const handle = await withStore<FileSystemDirectoryHandle | undefined>("readonly", (store) => store.get(HANDLE_KEY))
      return handle ? new HandleFolder(handle, (await isInBrowserStorage(handle)) ? "browser" : "disk") : null
    } catch {
      return null
    }
  }

  async ensurePermission(): Promise<boolean> {
    const handle = this.handle as FileSystemDirectoryHandle & {
      queryPermission?: (o: { mode: string }) => Promise<string>
      requestPermission?: (o: { mode: string }) => Promise<string>
    }
    if ((await handle.queryPermission?.({ mode: "readwrite" })) === "granted") return true
    return (await handle.requestPermission?.({ mode: "readwrite" })) === "granted"
  }

  private async fileAt(path: string, create = false): Promise<FileSystemFileHandle> {
    const parts = path.split("/").filter(Boolean)
    let dir = this.handle
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create })
    return dir.getFileHandle(parts[parts.length - 1], { create })
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.fileAt(path)
      return true
    } catch {
      return false
    }
  }

  async readFile(path: string): Promise<File> {
    return (await this.fileAt(path)).getFile()
  }

  async readText(path: string): Promise<string> {
    return (await this.readFile(path)).text()
  }

  async readJSON<T = unknown>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T
  }

  async writeText(path: string, text: string): Promise<void> {
    const writable = await (await this.fileAt(path, true)).createWritable()
    await writable.write(text)
    await writable.close()
    this.written.set(path, Date.now())
  }

  async writeJSON(path: string, value: unknown): Promise<void> {
    await this.writeText(path, JSON.stringify(value, null, 2) + "\n")
  }

  async writeFile(path: string, data: Blob | ArrayBuffer): Promise<void> {
    const writable = await (await this.fileAt(path, true)).createWritable()
    await writable.write(data)
    await writable.close()
    this.written.set(path, Date.now())
  }

  private async dirAt(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let dir = this.handle
    for (const part of path.split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create })
    return dir
  }

  async stat(path: string): Promise<FileInfo> {
    const file = await (await this.fileAt(path)).getFile()
    return { size: file.size, modified: file.lastModified }
  }

  async mkdir(path: string): Promise<void> {
    await this.dirAt(path, true)
  }

  async remove(path: string): Promise<void> {
    const name = path.split("/").filter(Boolean).pop()
    if (!name) return
    await (await this.dirAt(parentOf(path))).removeEntry(name, { recursive: true })
  }

  /** The File System Access API has no move, so a file is copied and the old one removed; a folder recursively. */
  async rename(from: string, to: string): Promise<void> {
    const entries = await this.list(parentOf(from))
    const entry = entries.find((e) => e.path === from)
    if (!entry) throw new Error(`${from} is not in the project`)
    if (entry.kind === "file") {
      await this.writeFile(to, await this.readFile(from))
    } else {
      await this.mkdir(to)
      for (const child of await this.list(from)) await this.rename(child.path, `${to}/${child.name}`)
    }
    await this.remove(from)
  }

  /** The browser has no file events, so a folder on disk is polled: the root, scripts/ and prefabs/ files by modification time. */
  async watch(listener: (paths: string[]) => void): Promise<() => void> {
    if (this.storage !== "disk") return () => undefined
    const stamp = async (): Promise<Map<string, number>> => {
      const out = new Map<string, number>()
      for (const dir of POLLED_DIRS) {
        for (const entry of await this.list(dir)) {
          if (entry.kind !== "file") continue
          try {
            out.set(entry.path, (await this.readFile(entry.path)).lastModified)
          } catch {}
        }
      }
      return out
    }
    let last = await stamp()
    let stopped = false
    let busy = false
    const timer = setInterval(() => {
      if (stopped || busy) return
      busy = true
      void stamp()
        .then((next) => {
          const changed: string[] = []
          for (const [path, modified] of next) if (last.get(path) !== modified) changed.push(path)
          for (const path of last.keys()) if (!next.has(path)) changed.push(path)
          last = next
          const theirs = changed.filter((path) => !(this.written.get(path) !== undefined && Date.now() - this.written.get(path)! < POLL_MS * 2))
          if (!stopped && theirs.length) listener(theirs)
        })
        .finally(() => (busy = false))
    }, POLL_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }

  async importFile(file: File, dir = "assets"): Promise<string> {
    const path = await importPath(this, file, dir)
    await this.writeFile(path, file)
    return path
  }

  async list(dir = ""): Promise<FolderEntry[]> {
    let handle = this.handle
    try {
      for (const part of dir.split("/").filter(Boolean)) handle = await handle.getDirectoryHandle(part)
    } catch {
      return []
    }
    const out: FolderEntry[] = []
    for await (const [name, entry] of handle as unknown as AsyncIterable<[string, FileSystemHandle]>) out.push({ path: dir ? `${dir}/${name}` : name, name, kind: entry.kind })
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  async clear(): Promise<void> {
    for await (const [name] of this.handle as unknown as AsyncIterable<[string, FileSystemHandle]>) await this.handle.removeEntry(name, { recursive: true })
  }

  transfer(): FolderTransfer {
    return { kind: "handle", handle: this.handle }
  }
}

const isInBrowserStorage = async (handle: FileSystemDirectoryHandle): Promise<boolean> => {
  if (!HandleFolder.hasBrowserStorage) return false
  try {
    const root = await navigator.storage.getDirectory()
    return (await root.resolve(handle)) !== null
  } catch {
    return false
  }
}

/** Projects through the browser: the File System Access picker on disk, the origin private file system otherwise. */
export const browserFolders: FolderSource = {
  get isSupported() {
    return HandleFolder.isSupported
  },
  get hasBrowserStorage() {
    return HandleFolder.hasBrowserStorage
  },
  pick: () => HandleFolder.pick(),
  last: () => HandleFolder.last(),
  inBrowser: (name) => HandleFolder.inBrowser(name),
  browserProjects: () => HandleFolder.browserProjects(),
  fromTransfer: (transfer) => {
    if (transfer.kind !== "handle") throw new Error("[catalyst-editor] a path cannot be opened through the browser")
    return new HandleFolder(transfer.handle)
  },
  hasLocations: false,
  pickLocation: async () => null,
  defaultLocation: async () => null,
  isTaken: async (name) => (await HandleFolder.browserProjects()).includes(browserProjectName(name)),
  canInitGit: false,
  initGit: async () => undefined,
  create: (name) => HandleFolder.inBrowser(browserProjectName(name)),
  recent: async () => {
    const out: RecentProject[] = []
    const last = await HandleFolder.last()
    if (last && last.storage === "disk") out.push({ id: "last", name: last.name, location: "a folder on disk, last opened", storage: "disk" })
    for (const name of await HandleFolder.browserProjects()) out.push({ id: `browser:${name}`, ...(await projectCard(await HandleFolder.inBrowser(name))), location: "in the browser", storage: "browser" })
    return out
  },
  openRecent: async (id) => {
    if (id === "last") return HandleFolder.last()
    if (!id.startsWith("browser:")) return null
    const name = id.slice("browser:".length)
    return (await HandleFolder.browserProjects()).includes(name) ? HandleFolder.inBrowser(name) : null
  },
  forget: async (id) => {
    if (id === "last") await withStore("readwrite", (store) => store.delete(HANDLE_KEY))
    else if (id.startsWith("browser:") && HandleFolder.hasBrowserStorage) {
      const root = await navigator.storage.getDirectory()
      const projects = await root.getDirectoryHandle(BROWSER_PROJECTS, { create: true })
      await projects.removeEntry(id.slice("browser:".length), { recursive: true }).catch(() => undefined)
    }
  },
}

/** A filesystem a desktop shell gives the editor: absolute paths, the shell's own picker. */
export interface NativeFs {
  pickDirectory(): Promise<string | null>
  /** Ask for a file with the shell's own dialog, limited to `extensions` (without dots) unless null; its absolute path, or null when cancelled. */
  pickFile?(extensions: string[] | null): Promise<string | null>
  exists(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  readBinary(path: string): Promise<Uint8Array>
  /** Bytes `start` to `end` (exclusive) of a file; without it the whole file is read. */
  readRange?(path: string, start: number, end: number): Promise<Uint8Array>
  writeText(path: string, text: string): Promise<void>
  writeBinary(path: string, data: Uint8Array): Promise<void>
  readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
  /** Move a file or folder; without it the folder copies and removes. */
  rename?(from: string, to: string): Promise<void>
  /** A file's size and modification time; without it the file is read for its size. */
  stat?(path: string): Promise<FileInfo>
  /** Start a git repository at the path, where the shell has git. */
  initGit?(path: string): Promise<void>
  /** Watch a directory tree; the listener gets absolute paths. Resolves to the way to stop. */
  watch?(path: string, listener: (paths: string[]) => void): Promise<() => void>
  /** The user's home folder, so paths can be shown from `~`. */
  homeDir?(): Promise<string>
  /** The user's Documents folder, where a first project goes unless another place is chosen. */
  documentsDir?(): Promise<string>
}

const RECENT_PATHS_KEY = "catalyst-editor:recent-project-paths"
const RECENT_OPENED_KEY = "catalyst-editor:recent-project-opened"
const LAST_LOCATION_KEY = "catalyst-editor:last-location"
const RECENT_MAX = 12

const readStored = <T>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback
  } catch {
    return fallback
  }
}

const writeStored = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

const openedTimes = (): Record<string, number> => readStored(RECENT_OPENED_KEY, {})

const fromHome = (path: string, home: string | undefined): string => {
  const root = home?.replace(/[\\/]+$/, "")
  return root && (path === root || path.startsWith(`${root}/`)) ? `~${path.slice(root.length)}` : path
}

const recentPaths = (): string[] => {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_PATHS_KEY) ?? "[]")
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : []
  } catch {
    return []
  }
}

const setRecentPaths = (paths: string[]): void => {
  try {
    localStorage.setItem(RECENT_PATHS_KEY, JSON.stringify(paths.slice(0, RECENT_MAX)))
  } catch {}
}

const browserProjectName = (name: string): string => name.trim().replace(/[\\/]+/g, "-") || "untitled"

const basename = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path

/** A project at an absolute path, through a native filesystem. */
const OWN_WRITE_MS = 1500

export class NativeFolder implements ProjectFolder {
  readonly path: string
  readonly storage: ProjectStorage = "native"
  private readonly fs: NativeFs
  private readonly written = new Map<string, number>()

  constructor(fs: NativeFs, path: string) {
    this.fs = fs
    this.path = path
  }

  get name(): string {
    return basename(this.path)
  }

  private at(path: string): string {
    return path ? `${this.path}/${path.split("/").filter(Boolean).join("/")}` : this.path
  }

  async remember(): Promise<void> {
    setRecentPaths([this.path, ...recentPaths().filter((p) => p !== this.path)])
    writeStored(RECENT_OPENED_KEY, { ...openedTimes(), [this.path]: Date.now() })
  }

  async ensurePermission(): Promise<boolean> {
    return this.fs.exists(this.path)
  }

  exists(path: string): Promise<boolean> {
    return this.fs.exists(this.at(path))
  }

  async readFile(path: string): Promise<File> {
    const bytes = await this.fs.readBinary(this.at(path))
    return new File([bytes as BlobPart], basename(path))
  }

  async readRange(path: string, start: number, end: number): Promise<Blob> {
    if (!this.fs.readRange) return (await this.readFile(path)).slice(start, end)
    return new Blob([(await this.fs.readRange(this.at(path), start, end)) as BlobPart])
  }

  readText(path: string): Promise<string> {
    return this.fs.readText(this.at(path))
  }

  async readJSON<T = unknown>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T
  }

  private async ensureDir(path: string): Promise<void> {
    const parts = path.split("/").filter(Boolean).slice(0, -1)
    let dir = ""
    for (const part of parts) {
      dir = dir ? `${dir}/${part}` : part
      if (!(await this.fs.exists(this.at(dir)))) await this.fs.mkdir(this.at(dir))
    }
  }

  private noteWrite(path: string): void {
    this.written.set(this.at(path), Date.now())
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.ensureDir(path)
    this.noteWrite(path)
    await this.fs.writeText(this.at(path), text)
  }

  async writeJSON(path: string, value: unknown): Promise<void> {
    await this.writeText(path, JSON.stringify(value, null, 2) + "\n")
  }

  async writeFile(path: string, data: Blob | ArrayBuffer): Promise<void> {
    await this.ensureDir(path)
    const buffer = data instanceof Blob ? await data.arrayBuffer() : data
    this.noteWrite(path)
    await this.fs.writeBinary(this.at(path), new Uint8Array(buffer))
  }

  async watch(listener: (paths: string[]) => void): Promise<() => void> {
    if (!this.fs.watch) return () => undefined
    const root = `${this.path}/`
    return this.fs.watch(this.path, (absolute) => {
      const now = Date.now()
      const changed = absolute
        .filter((path) => path.startsWith(root))
        .filter((path) => {
          const at = this.written.get(path)
          return !(at !== undefined && now - at < OWN_WRITE_MS)
        })
        .map((path) => path.slice(root.length))
      if (changed.length) listener([...new Set(changed)])
    })
  }

  async importFile(file: File, dir = "assets"): Promise<string> {
    const path = await importPath(this, file, dir)
    await this.writeFile(path, file)
    return path
  }

  async stat(path: string): Promise<FileInfo> {
    if (this.fs.stat) return this.fs.stat(this.at(path))
    const bytes = await this.fs.readBinary(this.at(path))
    return { size: bytes.byteLength, modified: 0 }
  }

  async mkdir(path: string): Promise<void> {
    await this.fs.mkdir(this.at(path))
  }

  async remove(path: string): Promise<void> {
    await this.fs.remove(this.at(path))
  }

  async rename(from: string, to: string): Promise<void> {
    await this.ensureDir(to)
    if (this.fs.rename) return this.fs.rename(this.at(from), this.at(to))
    const entries = await this.fs.readDir(this.at(parentOf(from)))
    const entry = entries.find((e) => e.name === from.split("/").pop())
    if (!entry) throw new Error(`${from} is not in the project`)
    if (entry.isDirectory) {
      await this.fs.mkdir(this.at(to))
      for (const child of await this.fs.readDir(this.at(from))) await this.rename(`${from}/${child.name}`, `${to}/${child.name}`)
    } else await this.fs.writeBinary(this.at(to), await this.fs.readBinary(this.at(from)))
    await this.fs.remove(this.at(from))
  }

  async list(dir = ""): Promise<FolderEntry[]> {
    try {
      const entries = await this.fs.readDir(this.at(dir))
      return entries.map((entry) => ({ path: dir ? `${dir}/${entry.name}` : entry.name, name: entry.name, kind: entry.isDirectory ? ("directory" as const) : ("file" as const) })).sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  }

  async clear(): Promise<void> {
    for (const entry of await this.fs.readDir(this.path)) await this.fs.remove(`${this.path}/${entry.name}`)
  }

  transfer(): FolderTransfer {
    return { kind: "path", path: this.path }
  }
}

/** Projects through a desktop shell's filesystem: folders picked by path, the last one remembered by path. */
/**
 * Folders through a desktop shell's filesystem. A shell that can show its
 * own file dialog takes over `pickFile` too: a webview may not open the
 * browser's chooser from a click that has passed through the command queue.
 */
export const nativeFolders = (fs: NativeFs): FolderSource => {
  if (fs.pickFile) nativePicker = async (accept) => {
    const path = await fs.pickFile!(acceptedExtensions(accept)?.map((extension) => extension.slice(1)) ?? null)
    return path ? new File([(await fs.readBinary(path)) as BlobPart], basename(path)) : null
  }
  return nativeFolderSource(fs)
}

const nativeFolderSource = (fs: NativeFs): FolderSource => ({
  isSupported: true,
  hasBrowserStorage: false,
  pick: async () => {
    const path = await fs.pickDirectory()
    return path ? new NativeFolder(fs, path) : null
  },
  last: async () => {
    const path = recentPaths()[0]
    return path && (await fs.exists(path)) ? new NativeFolder(fs, path) : null
  },
  hasLocations: true,
  pickLocation: () => fs.pickDirectory(),
  defaultLocation: async () => {
    for (const candidate of [readStored<string | null>(LAST_LOCATION_KEY, null), await fs.documentsDir?.()]) {
      if (candidate && (await fs.exists(candidate))) return candidate.replace(/[\\/]+$/, "")
    }
    return null
  },
  isTaken: async (name, location) => Boolean(location) && fs.exists(`${location!.replace(/[\\/]+$/, "")}/${slug(name)}`),
  canInitGit: typeof fs.initGit === "function",
  initGit: async (folder) => {
    if (!(folder instanceof NativeFolder)) throw new Error("[catalyst-editor] git can only be started in a folder on disk")
    await fs.initGit?.(folder.path)
  },
  create: async (name, location) => {
    if (!location) throw new Error("[catalyst-editor] a new project needs a location")
    const path = `${location.replace(/[\\/]+$/, "")}/${slug(name)}`
    if (!(await fs.exists(path))) await fs.mkdir(path)
    writeStored(LAST_LOCATION_KEY, location)
    return new NativeFolder(fs, path)
  },
  recent: async () => {
    const home = await fs.homeDir?.()
    const opened = openedTimes()
    return Promise.all(
      recentPaths().map(async (path) => {
        const missing = !(await fs.exists(path))
        const card = missing ? { name: basename(path), image: null } : await projectCard(new NativeFolder(fs, path))
        return { id: path, ...card, location: fromHome(path, home), storage: "native" as const, missing, opened: opened[path] }
      }),
    )
  },
  openRecent: async (path) => ((await fs.exists(path)) ? new NativeFolder(fs, path) : null),
  forget: async (path) => {
    setRecentPaths(recentPaths().filter((p) => p !== path))
    const { [path]: _, ...rest } = openedTimes()
    writeStored(RECENT_OPENED_KEY, rest)
  },
  inBrowser: () => Promise.reject(new Error("[catalyst-editor] projects live on disk here")),
  browserProjects: async () => [],
  fromTransfer: (transfer) => {
    if (transfer.kind !== "path") throw new Error("[catalyst-editor] a handle cannot be opened through the native filesystem")
    return new NativeFolder(fs, transfer.path)
  },
})

let nativePicker: ((accept: string) => Promise<File | null>) | null = null

/** Ask the user for a file: through the desktop shell's own dialog where there is one, else the browser's chooser; null when they cancel. */
export const pickFile = (accept: string): Promise<File | null> => (nativePicker ? nativePicker(accept) : pickFileInBrowser(accept))

const pickFileInBrowser = (accept: string): Promise<File | null> =>
  new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = accept
    input.style.display = "none"
    document.body.appendChild(input)
    let done = false
    const finish = (file: File | null) => {
      if (done) return
      done = true
      input.remove()
      resolve(file)
    }
    input.addEventListener("change", () => finish(input.files?.[0] ?? null))
    window.addEventListener("focus", () => setTimeout(() => finish(input.files?.[0] ?? null), 400), { once: true })
    input.click()
  })

const isAbsolute = (url: string): boolean => /^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith("blob:") || url.startsWith("data:")

/**
 * An engine loader that reads relative URLs from the project folder and
 * passes absolute ones to the network, so a scene file and the files it
 * names load from disk exactly as they would from a server.
 */
export const folderLoader = (folder: ProjectFolder, fallback: Loader = fetchLoader()): Loader => ({
  fetch: (url, init) => (isAbsolute(url) ? (fallback.fetch ?? fetch)(url, init) : folderResponse(folder, url, init)),
  json: (url) => (isAbsolute(url) ? fallback.json(url) : folder.readJSON(url)),
  text: (url) => (isAbsolute(url) ? fallback.text(url) : folder.readText(url)),
  arrayBuffer: async (url) => (isAbsolute(url) ? fallback.arrayBuffer(url) : (await folder.readFile(url)).arrayBuffer()),
  stream: async (url, onProgress) => {
    if (isAbsolute(url) && fallback.stream) return fallback.stream(url, onProgress)
    const buffer = isAbsolute(url) ? await fallback.arrayBuffer(url) : await (await folder.readFile(url)).arrayBuffer()
    onProgress(buffer.byteLength, buffer.byteLength)
    return buffer
  },
})

const CONTENT_TYPES: Record<string, string> = { json: "application/json", bin: "application/octet-stream", webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", ktx2: "image/ktx2", avif: "image/avif" }

/** A file in the folder answered as a server would: HEAD, a single `bytes=` Range as a 206, a missing file as a 404. */
const folderResponse = async (folder: ProjectFolder, url: string, init?: RequestInit): Promise<Response> => {
  const path = url.replace(/[?#].*$/, "")
  const type = CONTENT_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream"
  if ((init?.method ?? "GET").toUpperCase() === "HEAD") return new Response(null, { status: (await folder.exists(path).catch(() => false)) ? 200 : 404, headers: { "Content-Type": type } })
  const range = /^bytes=(\d+)-(\d*)$/.exec(new Headers(init?.headers).get("Range") ?? "")
  try {
    if (range) {
      const start = Number(range[1])
      const end = range[2] ? Number(range[2]) + 1 : Infinity
      const body = folder.readRange && Number.isFinite(end) ? await folder.readRange(path, start, end) : (await folder.readFile(path)).slice(start, end)
      return new Response(body, { status: 206, headers: { "Content-Type": type, "Content-Range": `bytes ${start}-${start + body.size - 1}/*` } })
    }
    return new Response(await folder.readFile(path), { status: 200, headers: { "Content-Type": type } })
  } catch {
    return new Response(null, { status: 404 })
  }
}
