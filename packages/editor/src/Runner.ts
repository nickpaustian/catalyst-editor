import type { Catalyst, Node3D } from "@nickpaustian/catalyst"
import { DebugOverlay, Node3D as Node3DClass } from "@nickpaustian/catalyst"
import { AssetFolder } from "./AssetFolder"
import { browserFolders, folderLoader, type FolderSource, type ProjectFolder } from "./ProjectFolder"
import type { Recipe } from "./recipe"
import { windowRunnerPageLink, type RunMessage, type RunnerPageLink } from "./RunnerLink"
import { ScriptCompiler } from "./ScriptCompiler"
import { readProjectSettings, slug } from "./project"
import { overlaid } from "./recovery"
import { SignalTap } from "./signalTap"
import { ConsoleTap } from "./consoleTap"

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
  private linked = true
  private readonly link: RunnerPageLink | null
  private tap: SignalTap | null = null
  /** The page's console, heard for as long as the runner is linked to an editor. */
  private readonly console: ConsoleTap | null
  private frequentSignals = false
  /** The stats block over the canvas; the backquote key shows and hides it. */
  readonly debug: DebugOverlay

  /** `link: null` plays only what `playProject` is given, as a published page does. */
  constructor(engine: Catalyst, recipe: Recipe, options: { folders?: FolderSource; link?: RunnerPageLink | null; debug?: boolean } = {}) {
    this.engine = engine
    this.recipe = recipe
    this.folders = options.folders ?? browserFolders
    this.debug = new DebugOverlay(engine, { visible: options.debug ?? false })
    window.addEventListener("keydown", (event) => {
      if (event.code === "Backquote" && !isTyping(event)) this.debug.toggle()
    })
    for (const { kind, cls } of recipe.kinds) if (!engine.registry.has(kind) && typeof cls === "function") engine.register({ [kind]: cls as any })
    const link = options.link === null ? null : (options.link ?? windowRunnerPageLink())
    this.link = link
    const report = link?.report?.bind(link)
    this.console = report ? new ConsoleTap((entries) => report({ type: "catalyst:console", entries })) : null
    const unsubscribeRun = link?.onRun((message) => void this.play(message)) ?? (() => undefined)
    const unsubscribeOptions =
      link?.onOptions?.((options) => {
        this.frequentSignals = options.frequentSignals
        if (this.tap) this.tap.frequent = options.frequentSignals
      }) ?? (() => undefined)
    this.unsubscribe = () => {
      unsubscribeRun()
      unsubscribeOptions()
    }
    link?.ready()
    this.linked = link !== null
  }

  get isPlaying(): boolean {
    return this.root !== null
  }

  async play(message: RunMessage): Promise<void> {
    const folder = message.folder ? this.folders.fromTransfer(message.folder) : null
    const files = Object.fromEntries(Object.entries(message.files ?? {}).map(([path, json]) => [path, JSON.stringify(json)]))
    this.engine.launch = { ...(message.launch ?? {}) }
    await this.playProject(message.scene, folder && message.files ? overlaid(folder, files) : folder)
  }

  /** Play a scene, its names already paths, with the files it names read from `folder`. */
  async playProject(scene: RunMessage["scene"], from: ProjectFolder | null): Promise<void> {
    this.stop()
    this.console?.restart()
    const folder = from ? await AssetFolder.open(from) : null
    if (folder) this.engine.loader = folderLoader(folder)
    // Saves are the project's own, apart from any other played on this site or in this editor.
    if (folder) this.engine.saves.namespace = slug((await readProjectSettings(folder).catch(() => null))?.name ?? folder.name)
    this.engine.scripts.invalidate()
    if (folder) this.engine.scripts.loader = new ScriptCompiler(folder).loader
    const made = this.engine.create(scene)
    const root = made instanceof Node3DClass ? made : (new Node3DClass("scene").addNode(made).parent as Node3D)
    this.root = root
    this.engine.add(root)
    const report = this.link?.report?.bind(this.link)
    if (report) {
      this.tap = new SignalTap(this.engine, root, (fired) => report({ type: "catalyst:signals", fired }))
      this.tap.frequent = this.frequentSignals
    }
    this.teardown = await this.recipe.run({ engine: this.engine, root, scene, folder })
    if (this.linked) document.title = `${folder?.name ?? "untitled"} · running`
  }

  stop(): void {
    this.tap?.dispose()
    this.tap = null
    this.teardown?.()
    this.teardown = null
    this.root?.dispose()
    this.root = null
  }

  dispose(): void {
    this.stop()
    this.console?.dispose()
    this.unsubscribe()
  }
}

const isTyping = (event: KeyboardEvent): boolean => {
  const target = event.target as HTMLElement | null
  return !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
}
