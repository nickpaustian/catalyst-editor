import { createLightspeedApp, type LightspeedRuntime } from "@lightspeed-js/core"
import { compileComponents } from "@lightspeed-js/core/compile"
import { UIElement, svgIcon, type Catalyst, type ExposedProperty, type UIElementOptions } from "@nickpaustian/catalyst"
import { transform } from "sucrase"
import { editorModules } from "../ScriptCompiler"

export interface ComponentOptions extends UIElementOptions {
  /** A Lightspeed `.lsp` file in the project, fetched through the engine's loader. */
  source?: string
}

type MountHandle = NonNullable<Awaited<ReturnType<LightspeedRuntime["mount"]>>>

const runtimes = new WeakMap<Catalyst, LightspeedRuntime>()
let compiled = 0

/**
 * The Lightspeed runtime a project's components run in, one per engine and
 * apart from the editor's own, so a project's cells never meet the editor's.
 * Scripts and components talk through its cells: `componentRuntime(engine).shared("score")`.
 */
export const componentRuntime = (engine: Catalyst): LightspeedRuntime => {
  let runtime = runtimes.get(engine)
  if (!runtime) runtimes.set(engine, (runtime = createLightspeedApp()))
  return runtime
}

const transpile = (logic: string): string => transform(logic, { transforms: ["typescript"], disableESTransforms: true, keepUnusedImports: true }).code

const load = async (specifier: string): Promise<Record<string, unknown>> => {
  const module = editorModules[specifier]
  if (!module) throw new Error(`a component may import @lightspeed-js/core or ${Object.keys(editorModules).join(", ")}, not ${specifier}`)
  return module as Record<string, unknown>
}

/**
 * A Lightspeed component from the project, drawn on a slate: the `.lsp`
 * file is compiled where the scene runs and mounted in its own runtime
 * (`componentRuntime`). Its styles are copied into the slate, as the
 * document's styles do not reach a slate's shadow root.
 */
export class Component extends UIElement {
  static icon = svgIcon('<path d="M8 1.5 14 5v6l-6 3.5L2 11V5z"/><path d="M2 5l6 3.5L14 5M8 8.5V14.5"/>')
  static uiClass = "component"
  static exposed: ExposedProperty[] = [{ key: "source", type: "file", accept: ".lsp", default: "" }]
  private _source: string
  private readonly style = document.createElement("style")
  private readonly mountPoint = document.createElement("div")
  private handle: { runtime: LightspeedRuntime; mount: MountHandle } | null = null
  private generation = 0
  private loading: Promise<void> | null = null

  constructor(options: ComponentOptions = {}) {
    super({ ...options, name: options.name ?? "component" })
    this._source = options.source ?? ""
    this.mountPoint.style.display = "contents"
    this.element.append(this.style, this.mountPoint)
  }

  get source(): string {
    return this._source
  }

  set source(url: string) {
    if (url === this._source) return
    this._source = url ?? ""
    const engine = this.engineOrNull
    if (engine) this.loading = this.load(engine)
  }

  /** The files this node reads, for a host that reloads it when one changes. */
  get files(): string[] {
    return this._source ? [this._source] : []
  }

  /** Resolves when the current file is mounted, or has failed. */
  get ready(): Promise<void> {
    return this.loading ?? Promise.resolve()
  }

  /** A cell of the runtime the project's components share, for a script to talk to them: `component.shared("score").set(3)`. */
  shared(name: string, initial?: unknown) {
    return componentRuntime(this.engine).shared(name, initial)
  }

  /** Compile the file again and remount it, after it changed. */
  reload(): Promise<void> {
    const engine = this.engineOrNull
    this.loading = engine ? this.load(engine) : null
    return this.ready
  }

  protected override onEnter(engine: Catalyst): void {
    super.onEnter(engine)
    this.loading = this.load(engine)
  }

  protected override onExit(engine: Catalyst): void {
    super.onExit(engine)
    this.generation++
    this.unmount()
  }

  private async load(engine: Catalyst): Promise<void> {
    const generation = ++this.generation
    this.unmount()
    const url = this._source
    if (!url) return
    try {
      const source = await engine.loader.text(url)
      if (generation !== this.generation) return
      const id = `project-component-${++compiled}`
      const definitions = await compileComponents([{ id, source }], transpile, load)
      if (generation !== this.generation) return
      const definition = definitions[id]
      const runtime = componentRuntime(engine)
      runtime.useComponents({ [id]: async () => definition })
      this.style.textContent = [definition.style, definition.styleDeferred].filter(Boolean).join("\n")
      const mount = await runtime.mount(id, this.mountPoint, { node: this.name })
      if (!mount) throw new Error("it did not mount")
      if (generation !== this.generation) return runtime.unmount(mount)
      this.handle = { runtime, mount }
    } catch (error) {
      if (generation !== this.generation) return
      engine.log(`"${this.name}" could not show ${url}: ${error instanceof Error ? error.message : error}`, "ui")
    }
  }

  private unmount(): void {
    if (this.handle) this.handle.runtime.unmount(this.handle.mount)
    this.handle = null
    this.style.textContent = ""
    this.mountPoint.replaceChildren()
  }
}
