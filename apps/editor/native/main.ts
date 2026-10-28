// The player for the native runner: the same runtime, recipe, script compiler and folder reads as the published
// page, over the project folder the host hands it, played as ▶ Run plays a project. Bundled by
// scripts/build-native-player.mjs into public/native-player/player.js, which the desktop shell passes to the runner.
import { boot, type NodeJSON } from "@nickpaustian/catalyst"
import { AssetFolder } from "../../../packages/editor/src/AssetFolder"
import { createEngine } from "../../../packages/editor/src/engine"
import type { FileInfo, FolderEntry, FolderTransfer, ProjectFolder, ProjectStorage } from "../../../packages/editor/src/ProjectFolder"
import { sceneRecipe } from "../../../packages/editor/src/recipes/scene"
import { Runner } from "../../../packages/editor/src/Runner"

interface HostFiles {
  name(): string
  exists(path: string): boolean
  read_text(path: string): string
  read_bytes(path: string): ArrayBuffer
  stat(path: string): string
  list(dir: string): string
}

interface Launch {
  scene: string
  /** What a page's query string would give the player. */
  params?: Record<string, string>
  width: number
  height: number
  scale: number
}

const host = globalThis as unknown as { __files: HostFiles; __launch: Launch }

const READ_ONLY = "the native player reads the project; it writes nothing"

/** A file as the folder reads it: what the loaders and the compiler ask of a `File`, without the browser's class. */
const fileOf = (path: string, bytes: ArrayBuffer): File =>
  ({
    name: path.slice(path.lastIndexOf("/") + 1),
    size: bytes.byteLength,
    type: "",
    lastModified: 0,
    arrayBuffer: async () => bytes,
    text: async () => host.__files.read_text(path),
    slice: (start = 0, end = bytes.byteLength) => fileOf(path, bytes.slice(start, end)) as unknown as Blob,
  }) as unknown as File

/** The project on disk, through the host. */
class NativeFolder implements ProjectFolder {
  readonly storage: ProjectStorage = "native"
  readonly name = host.__files.name()
  async remember(): Promise<void> {}
  async ensurePermission(): Promise<boolean> {
    return true
  }
  async exists(path: string): Promise<boolean> {
    return host.__files.exists(path)
  }
  async readFile(path: string): Promise<File> {
    return fileOf(path, host.__files.read_bytes(path))
  }
  async readText(path: string): Promise<string> {
    return host.__files.read_text(path)
  }
  async readJSON<T = unknown>(path: string): Promise<T> {
    return JSON.parse(host.__files.read_text(path)) as T
  }
  async stat(path: string): Promise<FileInfo> {
    return JSON.parse(host.__files.stat(path)) as FileInfo
  }
  async list(dir = ""): Promise<FolderEntry[]> {
    return (JSON.parse(host.__files.list(dir)) as { name: string; path: string; kind: "file" | "folder" }[]).map((entry) => ({ name: entry.name, path: entry.path, kind: entry.kind === "folder" ? "directory" : "file" }))
  }
  transfer(): FolderTransfer {
    return { kind: "path", path: "" }
  }
  async writeText(): Promise<void> {
    throw new Error(READ_ONLY)
  }
  async writeJSON(): Promise<void> {
    throw new Error(READ_ONLY)
  }
  async writeFile(): Promise<void> {
    throw new Error(READ_ONLY)
  }
  async importFile(): Promise<string> {
    throw new Error(READ_ONLY)
  }
  async mkdir(): Promise<void> {
    throw new Error(READ_ONLY)
  }
  async remove(): Promise<void> {
    throw new Error(READ_ONLY)
  }
  async rename(): Promise<void> {
    throw new Error(READ_ONLY)
  }
  async clear(): Promise<void> {
    throw new Error(READ_ONLY)
  }
}

await boot()
const engine = createEngine(sceneRecipe, { grid: false })
engine.start()
const runner = new Runner(engine, sceneRecipe, { link: null })
engine.launch = { ...(host.__launch.params ?? {}) }
Object.assign(globalThis, { engine, runner })
const folder = await AssetFolder.open(new NativeFolder())
const scene = JSON.parse(host.__files.read_text(host.__launch.scene)) as NodeJSON
runner.playProject(scene, folder).catch((error: unknown) => console.error(`[player] this project could not be played: ${error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)}`))
