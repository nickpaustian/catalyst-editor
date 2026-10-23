import type { Catalyst, Node3D, NodeJSON } from "@nickpaustian/catalyst"
import { Node3D as Node3DClass } from "@nickpaustian/catalyst"
import { ProjectFolder, folderLoader } from "./ProjectFolder"
import type { Recipe } from "./recipe"
import { ScriptCompiler } from "./ScriptCompiler"

export interface RunMessage {
  type: "catalyst:run"
  recipe: string
  scene: NodeJSON
  folder: FileSystemDirectoryHandle | null
}

/**
 * The runner window's side: tells the editor it is ready, takes each scene
 * it is sent, and plays it through the recipe, swapping the scene in place
 * on the next run. The engine stays up throughout.
 */
export class Runner {
  private root: Node3D | null = null
  private teardown: (() => void) | null = null
  private readonly engine: Catalyst
  private readonly recipe: Recipe
  private readonly onMessage = (event: MessageEvent): void => {
    if (event.origin !== location.origin || event.data?.type !== "catalyst:run") return
    void this.play(event.data as RunMessage)
  }

  constructor(engine: Catalyst, recipe: Recipe) {
    this.engine = engine
    this.recipe = recipe
    for (const { kind, cls } of recipe.kinds) if (!engine.registry.has(kind) && typeof cls === "function") engine.register({ [kind]: cls as any })
    window.addEventListener("message", this.onMessage)
    window.opener?.postMessage({ type: "catalyst:ready" }, location.origin)
  }

  get isPlaying(): boolean {
    return this.root !== null
  }

  async play(message: RunMessage): Promise<void> {
    this.stop()
    const folder = message.folder ? new ProjectFolder(message.folder) : null
    if (folder) this.engine.loader = folderLoader(folder)
    this.engine.scripts.invalidate()
    if (folder) this.engine.scripts.loader = new ScriptCompiler(folder).loader
    const made = this.engine.create(message.scene)
    const root = made instanceof Node3DClass ? made : new Node3DClass("scene").addNode(made).parent as Node3D
    this.root = root
    this.engine.add(root)
    this.teardown = await this.recipe.run({ engine: this.engine, root, scene: message.scene, folder })
    document.title = `${folder?.name ?? "untitled"} · running`
  }

  stop(): void {
    this.teardown?.()
    this.teardown = null
    this.root?.dispose()
    this.root = null
  }

  dispose(): void {
    this.stop()
    window.removeEventListener("message", this.onMessage)
  }
}
