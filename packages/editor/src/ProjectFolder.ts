import { fetchLoader, type Loader } from "@nickpaustian/catalyst"

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>
  }
}

const HANDLE_DB = "vitrine-editor"
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
export class ProjectFolder {
  readonly handle: FileSystemDirectoryHandle

  constructor(handle: FileSystemDirectoryHandle) {
    this.handle = handle
  }

  get name(): string {
    return this.handle.name
  }

  static get isSupported(): boolean {
    return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function"
  }

  static async pick(): Promise<ProjectFolder | null> {
    if (!window.showDirectoryPicker) return null
    try {
      return new ProjectFolder(await window.showDirectoryPicker({ mode: "readwrite", id: "vitrine-project" }))
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
      return handle ? new ProjectFolder(handle) : null
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
}

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
