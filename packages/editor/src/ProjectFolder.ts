import { fetchLoader, type Loader } from "@nickpaustian/catalyst"

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>
  }
}

const HANDLE_DB = "catalyst-editor"
const HANDLE_STORE = "handles"
const HANDLE_KEY = "last-folder"

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

/**
 * A project on disk, through the File System Access API: files read and
 * written by path under one folder the user picked. The last folder is
 * remembered across reloads, though the browser asks for a click before
 * giving it back.
 */
export type ProjectStorage = "disk" | "browser"

const BROWSER_PROJECTS = "projects"

export class ProjectFolder {
  readonly handle: FileSystemDirectoryHandle
  /** On disk through a folder the user picked, or in the browser's own storage. */
  readonly storage: ProjectStorage

  constructor(handle: FileSystemDirectoryHandle, storage: ProjectStorage = "disk") {
    this.handle = handle
    this.storage = storage
  }

  get name(): string {
    return this.handle.name
  }

  /** Whether folders on disk can be opened: the File System Access API, Chromium only. */
  static get isSupported(): boolean {
    return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function"
  }

  /** Whether projects can live in the browser's own storage (the origin private file system): everywhere current. */
  static get hasBrowserStorage(): boolean {
    return typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function"
  }

  /** A project kept by the browser, made if need be. Nothing on disk; import files into it and export it out. */
  static async inBrowser(name: string): Promise<ProjectFolder> {
    const root = await navigator.storage.getDirectory()
    const projects = await root.getDirectoryHandle(BROWSER_PROJECTS, { create: true })
    return new ProjectFolder(await projects.getDirectoryHandle(name, { create: true }), "browser")
  }

  /** The names of the projects the browser keeps. */
  static async browserProjects(): Promise<string[]> {
    if (!ProjectFolder.hasBrowserStorage) return []
    const root = await navigator.storage.getDirectory()
    const projects = await root.getDirectoryHandle(BROWSER_PROJECTS, { create: true })
    const names: string[] = []
    for await (const [name, entry] of projects as unknown as AsyncIterable<[string, FileSystemHandle]>) if (entry.kind === "directory") names.push(name)
    return names.sort()
  }

  static async pick(): Promise<ProjectFolder | null> {
    if (!window.showDirectoryPicker) return null
    try {
      return new ProjectFolder(await window.showDirectoryPicker({ mode: "readwrite", id: "catalyst-project" }))
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return null
      throw error
    }
  }

  async remember(): Promise<void> {
    await withStore("readwrite", (store) => store.put(this.handle, HANDLE_KEY))
  }

  static async last(): Promise<ProjectFolder | null> {
    try {
      const handle = await withStore<FileSystemDirectoryHandle | undefined>("readonly", (store) => store.get(HANDLE_KEY))
      return handle ? new ProjectFolder(handle, await isInBrowserStorage(handle) ? "browser" : "disk") : null
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

  /** Copy a file the user chose into the project, under `dir`, and give back its path; a name clash gets a number. */
  async importFile(file: File, dir = "assets"): Promise<string> {
    const base = file.name.replace(/[^\w.-]+/g, "-")
    const dot = base.lastIndexOf(".")
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ""
    let path = `${dir}/${base}`
    for (let n = 2; await this.exists(path); n++) path = `${dir}/${stem}-${n}${ext}`
    await this.writeFile(path, file)
    return path
  }

  /** The files directly under a directory, with their paths. */
  async list(dir = ""): Promise<{ path: string; name: string; kind: "file" | "directory" }[]> {
    let handle = this.handle
    try {
      for (const part of dir.split("/").filter(Boolean)) handle = await handle.getDirectoryHandle(part)
    } catch {
      return []
    }
    const out: { path: string; name: string; kind: "file" | "directory" }[] = []
    for await (const [name, entry] of handle as unknown as AsyncIterable<[string, FileSystemHandle]>) out.push({ path: dir ? `${dir}/${name}` : name, name, kind: entry.kind })
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Remove everything in the project. */
  async clear(): Promise<void> {
    for await (const [name] of this.handle as unknown as AsyncIterable<[string, FileSystemHandle]>) await this.handle.removeEntry(name, { recursive: true })
  }
}

const isInBrowserStorage = async (handle: FileSystemDirectoryHandle): Promise<boolean> => {
  if (!ProjectFolder.hasBrowserStorage) return false
  try {
    const root = await navigator.storage.getDirectory()
    return (await root.resolve(handle)) !== null
  } catch {
    return false
  }
}

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
