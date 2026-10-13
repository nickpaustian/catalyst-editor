import { DBManager } from "@vitrine/assets"
import {
  isAbsoluteUrl,
  resolveManifestPaths,
  type ExhibitionManifest,
  type LoadedManifest,
} from "@vitrine/runtime"

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite"
      id?: string
    }) => Promise<FileSystemDirectoryHandle>
  }
}

export interface ExhibitionFiles {
  manifest: ExhibitionManifest
  /** Path as written in the manifest → file text. */
  text: Record<string, string>
}

const HANDLE_DB = { name: "VITRINE-editor", store: "handles" }
const HANDLE_KEY = "last-folder"

/**
 * An exhibition on disk, through the File System Access API. The manifest's
 * relative paths are read into blob URLs so the runtime loads them exactly as
 * it would from a server; absolute URLs (the CDN assets) pass through.
 */
export class ExhibitionFolder {
  public readonly handle: FileSystemDirectoryHandle
  private blobUrls: string[] = []

  constructor(handle: FileSystemDirectoryHandle) {
    this.handle = handle
  }

  public get name(): string {
    return this.handle.name
  }

  public static get isSupported(): boolean {
    return typeof window.showDirectoryPicker === "function"
  }

  public static async pick(): Promise<ExhibitionFolder | null> {
    if (!window.showDirectoryPicker) return null
    try {
      const handle = await window.showDirectoryPicker({
        mode: "readwrite",
        id: "vitrine-exhibition",
      })
      return new ExhibitionFolder(handle)
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return null
      throw error
    }
  }

  // ---- remembering the last folder across reloads ----

  private static db(): DBManager {
    const db = new DBManager(HANDLE_DB.name, HANDLE_DB.store)
    void db.init()
    return db
  }

  public async remember(): Promise<void> {
    const db = ExhibitionFolder.db()
    await db.ready
    await db.write(HANDLE_KEY, this.handle)
  }

  /** The last folder, if the browser still lets us at it (may need a click to re-grant). */
  public static async last(): Promise<ExhibitionFolder | null> {
    const db = ExhibitionFolder.db()
    await db.ready
    const handle = await db.read<FileSystemDirectoryHandle>(HANDLE_KEY)
    return handle ? new ExhibitionFolder(handle) : null
  }

  public async ensurePermission(): Promise<boolean> {
    const handle = this.handle as FileSystemDirectoryHandle & {
      queryPermission?: (o: { mode: string }) => Promise<string>
      requestPermission?: (o: { mode: string }) => Promise<string>
    }
    if ((await handle.queryPermission?.({ mode: "readwrite" })) === "granted") return true
    return (await handle.requestPermission?.({ mode: "readwrite" })) === "granted"
  }

  // ---- reading ----

  private async fileAt(path: string, create = false): Promise<FileSystemFileHandle> {
    const parts = path.split("/").filter(Boolean)
    let dir = this.handle
    for (const part of parts.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(part, { create })
    }
    return dir.getFileHandle(parts[parts.length - 1], { create })
  }

  public async readText(path: string): Promise<string> {
    const file = await (await this.fileAt(path)).getFile()
    return file.text()
  }

  public async readManifest(): Promise<ExhibitionManifest> {
    const manifest = JSON.parse(await this.readText("manifest.json")) as ExhibitionManifest
    if (manifest.version !== 1) {
      throw new Error(`Unsupported manifest version ${manifest.version}`)
    }
    return manifest
  }

  /** The manifest with every relative file read into a blob URL. */
  public async load(): Promise<{ raw: ExhibitionManifest; loaded: LoadedManifest }> {
    this.revoke()
    const raw = await this.readManifest()
    const paths = new Set<string>()
    resolveManifestPaths(raw, (path) => {
      if (!isAbsoluteUrl(path)) paths.add(path)
      return path
    }, "")

    const urls = new Map<string, string>()
    await Promise.all(
      Array.from(paths).map(async (path) => {
        const file = await (await this.fileAt(path)).getFile()
        const url = URL.createObjectURL(file)
        this.blobUrls.push(url)
        urls.set(path, url)
      })
    )

    const loaded = resolveManifestPaths(
      raw,
      (path) => (isAbsoluteUrl(path) ? path : urls.get(path) ?? path),
      `folder:${this.name}/${raw.id}/${Date.now().toString(36)}`
    )
    return { raw, loaded }
  }

  public revoke(): void {
    this.blobUrls.forEach((url) => URL.revokeObjectURL(url))
    this.blobUrls = []
  }

  // ---- writing ----

  public async writeText(path: string, text: string): Promise<void> {
    const handle = await this.fileAt(path, true)
    const writable = await handle.createWritable()
    await writable.write(text)
    await writable.close()
  }

  /** Writes every file; paths are as the manifest names them. */
  public async writeAll(files: ExhibitionFiles): Promise<string[]> {
    const written: string[] = []
    await this.writeText("manifest.json", JSON.stringify(files.manifest, null, 2) + "\n")
    written.push("manifest.json")
    for (const [path, text] of Object.entries(files.text)) {
      await this.writeText(path, text)
      written.push(path)
    }
    return written
  }
}
