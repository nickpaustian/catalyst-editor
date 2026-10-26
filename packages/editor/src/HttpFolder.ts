import { FILE_INDEX } from "@nickpaustian/catalyst"
import type { FileInfo, FolderEntry, FolderTransfer, ProjectFolder, ProjectStorage } from "./ProjectFolder"

const READ_ONLY = "a published project is read-only"

/**
 * A published project: its files read over HTTP from under one URL, the way
 * a static host serves the folder an export wrote. Reads only; ranges are
 * asked of the server, so large files are never fetched whole for a part.
 */
export class HttpFolder implements ProjectFolder {
  readonly storage: ProjectStorage = "web"
  private readonly base: URL

  constructor(base: string | URL = new URL("./", location.href)) {
    this.base = new URL(base)
    if (!this.base.pathname.endsWith("/")) this.base.pathname += "/"
  }

  get name(): string {
    return decodeURIComponent(this.base.pathname.split("/").filter(Boolean).pop() ?? this.base.host)
  }

  private url(path: string): string {
    return new URL(path.split("/").filter(Boolean).map(encodeURIComponent).join("/"), this.base).href
  }

  private async get(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(this.url(path), init)
    if (!response.ok) throw new Error(`${path} is not in the project (${response.status})`)
    return response
  }

  async remember(): Promise<void> {}

  async ensurePermission(): Promise<boolean> {
    return true
  }

  /** A static host answers a missing file with a 404; a dev server or a single-page host may answer with its page, which a path not ending in `.html` never asks for. */
  async exists(path: string): Promise<boolean> {
    try {
      const response = await fetch(this.url(path), { method: "HEAD" })
      return response.ok && (/\.html?$/i.test(path) || !(response.headers.get("content-type") ?? "").includes("text/html"))
    } catch {
      return false
    }
  }

  async readFile(path: string): Promise<File> {
    const blob = await (await this.get(path)).blob()
    return new File([blob], path.slice(path.lastIndexOf("/") + 1), { type: blob.type })
  }

  async readRange(path: string, start: number, end: number): Promise<Blob> {
    const response = await this.get(path, { headers: { Range: `bytes=${start}-${end - 1}` } })
    const blob = await response.blob()
    return response.status === 206 ? blob : blob.slice(start, end)
  }

  async readText(path: string): Promise<string> {
    return (await this.get(path)).text()
  }

  async readJSON<T = unknown>(path: string): Promise<T> {
    return (await this.get(path)).json() as Promise<T>
  }

  async stat(path: string): Promise<FileInfo> {
    const response = await this.get(path, { method: "HEAD" })
    const modified = Date.parse(response.headers.get("last-modified") ?? "")
    return { size: Number(response.headers.get("content-length")) || 0, modified: Number.isFinite(modified) ? modified : 0 }
  }

  private index: Promise<string[]> | null = null

  /** The entries directly under `dir`, from the site's `files.json` index an export writes; nothing without one, as a web server lists nothing. */
  async list(dir = ""): Promise<FolderEntry[]> {
    this.index ??= this.readJSON<string[]>(FILE_INDEX).catch(() => [])
    const prefix = dir.replace(/^\/+|\/+$/g, "")
    const entries = new Map<string, FolderEntry>()
    for (const path of await this.index) {
      if (prefix && !path.startsWith(`${prefix}/`)) continue
      const rest = path.slice(prefix ? prefix.length + 1 : 0)
      const [name, ...deeper] = rest.split("/")
      const at = prefix ? `${prefix}/${name}` : name
      if (!entries.has(at)) entries.set(at, { path: at, name, kind: deeper.length ? "directory" : "file" })
    }
    return [...entries.values()]
  }

  transfer(): FolderTransfer {
    return { kind: "path", path: this.base.href }
  }

  writeText(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY))
  }

  writeJSON(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY))
  }

  writeFile(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY))
  }

  importFile(): Promise<string> {
    return Promise.reject(new Error(READ_ONLY))
  }

  mkdir(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY))
  }

  remove(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY))
  }

  rename(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY))
  }

  clear(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY))
  }
}
