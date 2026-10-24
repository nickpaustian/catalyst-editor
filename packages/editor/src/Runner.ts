import type { Catalyst, Node3D } from "@nickpaustian/catalyst"
import { DebugOverlay, Node3D as Node3DClass } from "@nickpaustian/catalyst"
import { browserFolders, folderLoader, type FolderSource } from "./ProjectFolder"
import type { Recipe } from "./recipe"
import { windowRunnerPageLink, type RunMessage, type RunnerPageLink } from "./RunnerLink"
import { ScriptCompiler } from "./ScriptCompiler"

export type { RunMessage } from "./RunnerLink"

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
  private readonly folders: FolderSource
  private readonly unsubscribe: () => void
  /** The stats block over the canvas; the backquote key shows and hides it. */
  readonly debug: DebugOverlay

  constructor(engine: Catalyst, recipe: Recipe, options: { folders?: FolderSource; link?: RunnerPageLink; debug?: boolean } = {}) {
    this.engine = engine
    this.recipe = recipe
    this.folders = options.folders ?? browserFolders
    this.debug = new DebugOverlay(engine, { visible: options.debug ?? false })
    window.addEventListener("keydown", (event) => {
      if (event.code === "Backquote" && !isTyping(event)) this.debug.toggle()
    })
    const link = options.link ?? windowRunnerPageLink()
    for (const { kind, cls } of recipe.kinds) if (!engine.registry.has(kind) && typeof cls === "function") engine.register({ [kind]: cls as any })
    this.unsubscribe = link.onRun((message) => void this.play(message))
    link.ready()
  }

  get isPlaying(): boolean {
    return this.root !== null
  }

  async play(message: RunMessage): Promise<void> {
    this.stop()
    const folder = message.folder ? this.folders.fromTransfer(message.folder) : null
    if (folder) this.engine.loader = folderLoader(folder)
    this.engine.scripts.invalidate()
    if (folder) this.engine.scripts.loader = new ScriptCompiler(folder).loader
    const made = this.engine.create(message.scene)
    const root = made instanceof Node3DClass ? made : (new Node3DClass("scene").addNode(made).parent as Node3D)
    this.root = root
    this.engine.add(root)
    this.teardown = await this.recipe.run({ engine: this.engine, root, scene: message.scene, folder })
    document.title = `${folder?.name ?? "untitled"} · running`
    const hint = document.getElementById("hint")
    if (hint && this.recipe.hint) hint.textContent = `${this.recipe.hint(root)} · \` stats`
  }

  stop(): void {
    this.teardown?.()
    this.teardown = null
    this.root?.dispose()
    this.root = null
  }

  dispose(): void {
    this.stop()
    this.unsubscribe()
  }
}

const isTyping = (event: KeyboardEvent): boolean => {
  const target = event.target as HTMLElement | null
  return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
}
