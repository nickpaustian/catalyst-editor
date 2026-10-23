import { fetchLoader, type Loader } from "@nickpaustian/catalyst"
import { readProjectSettings } from "./project"

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
  readText(path: string): Promise<string>
  readJSON<T = unknown>(path: string): Promise<T>
  writeText(path: string, text: string): Promise<void>
  writeJSON(path: string, value: unknown): Promise<void>
  writeFile(path: string, data: Blob | ArrayBuffer): Promise<void>
  /** Copy a file the user chose into the project, under `dir`, and give back its path; a name clash gets a number. */
  importFile(file: File, dir?: string): Promise<string>
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
  /** Where it lives, for the eye: a path, or "in the browser". */
  location: string
  storage: ProjectStorage
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

/** The name the project's file gives it, or the folder's own when there is none. */
const projectName = async (folder: ProjectFolder): Promise<string> => (await readProjectSettings(folder))?.name ?? folder.name

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
export class HandleFolder implements ProjectFolder {
  readonly handle: FileSystemDirectoryHandle
  readonly storage: ProjectStorage

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
  }

  async writeJSON(path: string, value: unknown): Promise<void> {
    await this.writeText(path, JSON.stringify(value, null, 2) + "\n")
  }

  async writeFile(path: string, data: Blob | ArrayBuffer): Promise<void> {
    const writable = await (await this.fileAt(path, true)).createWritable()
    await writable.write(data)
    await writable.close()
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
  canInitGit: false,
  initGit: async () => undefined,
  create: (name) => HandleFolder.inBrowser(name.trim().replace(/[\\/]+/g, "-") || "untitled"),
  recent: async () => {
    const out: RecentProject[] = []
    const last = await HandleFolder.last()
    if (last && last.storage === "disk") out.push({ id: "last", name: last.name, location: "a folder on disk, last opened", storage: "disk" })
    for (const name of await HandleFolder.browserProjects()) out.push({ id: `browser:${name}`, name: await projectName(await HandleFolder.inBrowser(name)), location: "in the browser", storage: "browser" })
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
  exists(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  readBinary(path: string): Promise<Uint8Array>
  writeText(path: string, text: string): Promise<void>
  writeBinary(path: string, data: Uint8Array): Promise<void>
  readDir(path: string): Promise<{ name: string; isDirectory: boolean }[]>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
  /** Start a git repository at the path, where the shell has git. */
  initGit?(path: string): Promise<void>
  /** Watch a directory tree; the listener gets absolute paths. Resolves to the way to stop. */
  watch?(path: string, listener: (paths: string[]) => void): Promise<() => void>
}

const RECENT_PATHS_KEY = "catalyst-editor:recent-project-paths"
const RECENT_MAX = 12

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
export const nativeFolders = (fs: NativeFs): FolderSource => ({
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
  canInitGit: typeof fs.initGit === "function",
  initGit: async (folder) => {
    if (!(folder instanceof NativeFolder)) throw new Error("[catalyst-editor] git can only be started in a folder on disk")
    await fs.initGit?.(folder.path)
  },
  create: async (name, location) => {
    if (!location) throw new Error("[catalyst-editor] a new project needs a location")
    const clean = name.trim().toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "project"
    const path = `${location.replace(/[\\/]+$/, "")}/${clean}`
    if (!(await fs.exists(path))) await fs.mkdir(path)
    return new NativeFolder(fs, path)
  },
  recent: () => Promise.all(recentPaths().map(async (path) => ({ id: path, name: (await fs.exists(path)) ? await projectName(new NativeFolder(fs, path)) : basename(path), location: path, storage: "native" as const }))),
  openRecent: async (path) => ((await fs.exists(path)) ? new NativeFolder(fs, path) : null),
  forget: async (path) => setRecentPaths(recentPaths().filter((p) => p !== path)),
  inBrowser: () => Promise.reject(new Error("[catalyst-editor] projects live on disk here")),
  browserProjects: async () => [],
  fromTransfer: (transfer) => {
    if (transfer.kind !== "path") throw new Error("[catalyst-editor] a handle cannot be opened through the native filesystem")
    return new NativeFolder(fs, transfer.path)
  },
})

/** Ask the user for a file through the browser's own chooser; null when they cancel. */
export const pickFile = (accept: string): Promise<File | null> =>
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
