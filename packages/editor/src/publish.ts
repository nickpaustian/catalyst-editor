import type { NodeJSON, SceneMetadata } from "@nickpaustian/catalyst"
import type { ProjectFolder } from "./ProjectFolder"

/** Where the published page's runtime is served beside the editor, with `files.json` listing it. */
export const PLAYER_DIR = "player/"
/** Where the project's files go in a published site, apart from the runtime's own `assets/`. */
export const PUBLISHED_PROJECT_DIR = "project/"
const SKIPPED = new Set([".git", "node_modules", ".DS_Store"])

/** What an export writes to: a folder, or a zip being put together. */
export interface PublishTarget {
  writeFile(path: string, data: Blob | ArrayBuffer): Promise<void>
}

export interface PublishOptions {
  project: ProjectFolder
  /** The scene as it is in the editor, unsaved edits included, its names paths. */
  scene: NodeJSON
  /** Saved as the project's scene file in place of the one on disk. */
  sceneFile: string
  target: PublishTarget
  /** Where the runtime's `files.json` is; the editor's own `player/` by default. */
  runtime?: URL
  onProgress?: (done: number, total: number) => void
}

/**
 * A project as a static site: the player runtime at the top, the project's
 * files under `project/`, the scene as it is now. Any static host serves it;
 * scans stream from it by HTTP Range, which they all answer.
 */
export const publish = async ({ project, scene, sceneFile, target, runtime = new URL(PLAYER_DIR, location.href), onProgress }: PublishOptions): Promise<number> => {
  const listed = await fetch(new URL("files.json", runtime))
  if (!listed.ok) throw new Error("the player runtime is missing: build it with `npm run build:player` in apps/editor")
  const runtimeFiles = (await listed.json()) as string[]
  const projectFiles = (await filesUnder(project, "")).filter((path) => path !== sceneFile)
  const total = runtimeFiles.length + projectFiles.length + 2
  let done = 0
  const step = () => onProgress?.(++done, total)
  for (const path of runtimeFiles) {
    const response = await fetch(new URL(path, runtime))
    if (!response.ok) throw new Error(`the player runtime's ${path} is missing (${response.status})`)
    const blob = await response.blob()
    await target.writeFile(path, path === "index.html" ? new Blob([named(await blob.text(), (scene as { metadata?: SceneMetadata }).metadata ?? {})], { type: "text/html" }) : blob)
    step()
  }
  // GitHub Pages runs Jekyll unless told not to, and Jekyll leaves out dotfiles such as the asset table.
  await target.writeFile(".nojekyll", new Blob([]))
  step()
  await target.writeFile(PUBLISHED_PROJECT_DIR + sceneFile, new Blob([JSON.stringify(scene, null, 2) + "\n"], { type: "application/json" }))
  step()
  for (const path of projectFiles) {
    await target.writeFile(PUBLISHED_PROJECT_DIR + path, await project.readFile(path))
    step()
  }
  return total
}

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)

/** The page's title and description from the record, in the HTML itself, for link previews and search, which don't run the page. */
const named = (html: string, metadata: SceneMetadata): string => {
  const tags: string[] = []
  if (metadata.title) tags.push(`<meta property="og:title" content="${escapeHtml(metadata.title)}" />`)
  if (metadata.description) tags.push(`<meta name="description" content="${escapeHtml(metadata.description)}" />`, `<meta property="og:description" content="${escapeHtml(metadata.description)}" />`)
  const titled = metadata.title ? html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(metadata.title)}</title>`) : html
  return tags.length ? titled.replace("</head>", `  ${tags.join("\n    ")}\n  </head>`) : titled
}

const filesUnder = async (folder: ProjectFolder, dir: string): Promise<string[]> => {
  const out: string[] = []
  for (const entry of await folder.list(dir)) {
    if (SKIPPED.has(entry.name)) continue
    if (entry.kind === "directory") out.push(...(await filesUnder(folder, entry.path)))
    else out.push(entry.path)
  }
  return out
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 1 January 1980, the earliest date a zip can hold. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1

/** A zip put together in memory, stored without compression: scans and images are compressed already. */
export class ZipTarget implements PublishTarget {
  private readonly parts: BlobPart[] = []
  private readonly central: Uint8Array[] = []
  private offset = 0
  private count = 0

  async writeFile(path: string, data: Blob | ArrayBuffer): Promise<void> {
    const bytes = new Uint8Array(data instanceof Blob ? await data.arrayBuffer() : data)
    const name = new TextEncoder().encode(path)
    const crc = crc32(bytes)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true)
    local.setUint16(12, DOS_DATE, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, bytes.length, true)
    local.setUint32(22, bytes.length, true)
    local.setUint16(26, name.length, true)
    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(14, DOS_DATE, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, bytes.length, true)
    entry.setUint32(24, bytes.length, true)
    entry.setUint16(28, name.length, true)
    entry.setUint32(42, this.offset, true)
    this.parts.push(local.buffer, name, bytes)
    this.central.push(new Uint8Array(entry.buffer), name)
    this.offset += 30 + name.length + bytes.length
    this.count++
  }

  blob(): Blob {
    const size = this.central.reduce((sum, part) => sum + part.length, 0)
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, this.count, true)
    end.setUint16(10, this.count, true)
    end.setUint32(12, size, true)
    end.setUint32(16, this.offset, true)
    return new Blob([...this.parts, ...(this.central as BlobPart[]), end.buffer], { type: "application/zip" })
  }
}
