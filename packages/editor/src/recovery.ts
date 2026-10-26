import type { FolderTransfer, ProjectFolder } from "./ProjectFolder"

const DB = "catalyst-editor-recovery"
const STORE = "projects"

/** Unsaved work kept against a crash: the files a save would have written, and the code pane's unsaved files. */
export interface Recovery {
  /** When it was kept, in ms since the epoch. */
  kept: number
  files: Record<string, string | Blob>
  code: { path: string; text: string }[]
  /** The node-tree file being edited, when it wasn't the project's own scene. */
  scene?: string | null
}

interface Stored extends Recovery {
  transfer: FolderTransfer
}

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const withStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** A folder on disk by its path; one behind a handle by its name, told apart from a namesake by the handle itself. */
const keyOf = (folder: ProjectFolder): string => {
  const transfer = folder.transfer()
  return transfer.kind === "path" ? `path:${transfer.path}` : `${folder.storage}:${folder.name}`
}

const sameFolder = async (a: FolderTransfer, b: FolderTransfer): Promise<boolean> => {
  if (a.kind === "path" && b.kind === "path") return a.path === b.path
  if (a.kind === "handle" && b.kind === "handle") return a.handle.isSameEntry(b.handle)
  return false
}

/** The unsaved work kept for this project, if there is any. */
export const readRecovery = async (folder: ProjectFolder): Promise<Recovery | null> => {
  const stored = await withStore<Stored | undefined>("readonly", (store) => store.get(keyOf(folder)))
  if (!stored || !(await sameFolder(stored.transfer, folder.transfer()))) return null
  return { kept: stored.kept, files: stored.files, code: Array.isArray(stored.code) ? stored.code : [], scene: stored.scene ?? null }
}

export const keepRecovery = async (folder: ProjectFolder, recovery: Recovery): Promise<void> => {
  await withStore("readwrite", (store) => store.put({ ...recovery, transfer: folder.transfer() } satisfies Stored, keyOf(folder)))
}

export const dropRecovery = async (folder: ProjectFolder): Promise<void> => {
  await withStore("readwrite", (store) => store.delete(keyOf(folder)))
}

/** `folder` with some of its methods replaced; the rest still run on the folder itself. */
const overriding = (folder: ProjectFolder, overrides: Partial<ProjectFolder>): ProjectFolder =>
  new Proxy(folder, {
    get(target, key) {
      if (key in overrides) return overrides[key as keyof ProjectFolder]
      const value = Reflect.get(target, key)
      return typeof value === "function" ? value.bind(target) : value
    },
  })

/** A folder that keeps what is written to it instead of writing it, so a save gives back the files it would have put on disk. */
export const capturing = (folder: ProjectFolder): { folder: ProjectFolder; files: Record<string, string | Blob> } => {
  const files: Record<string, string | Blob> = {}
  const nothing = async () => undefined
  return {
    files,
    folder: overriding(folder, {
      writeText: async (path, text) => void (files[path] = text),
      writeJSON: async (path, value) => void (files[path] = `${JSON.stringify(value, null, 2)}\n`),
      writeFile: async (path, data) => void (files[path] = data instanceof Blob ? data : new Blob([data])),
      mkdir: nothing,
      remove: nothing,
      rename: nothing,
    }),
  }
}

/** `folder` with `files` in place of what is on disk, for reading a project back as it was kept. */
export const overlaid = (folder: ProjectFolder, files: Record<string, string | Blob>): ProjectFolder => {
  const text = async (path: string) => {
    const kept = files[path]
    return typeof kept === "string" ? kept : kept.text()
  }
  return overriding(folder, {
    exists: async (path) => path in files || folder.exists(path),
    readText: async (path) => (path in files ? text(path) : folder.readText(path)),
    readJSON: async <T>(path: string) => (path in files ? (JSON.parse(await text(path)) as T) : folder.readJSON<T>(path)),
    readFile: async (path) => (path in files ? new File([files[path]], path.replace(/^.*\//, "")) : folder.readFile(path)),
  })
}
