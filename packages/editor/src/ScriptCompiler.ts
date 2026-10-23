import type { ScriptLoader, ScriptModule } from "@nickpaustian/catalyst"
import * as catalyst from "@nickpaustian/catalyst"
import * as input from "@nickpaustian/catalyst/input"
import * as interaction from "@nickpaustian/catalyst/interaction"
import * as physics from "@nickpaustian/catalyst/physics"
import * as prefabs from "@nickpaustian/catalyst/prefabs"
import * as resources from "@nickpaustian/catalyst/resources"
import * as splats from "@nickpaustian/catalyst/splats"
import * as three from "three"
import { transform } from "sucrase"
import type { ProjectFolder } from "./ProjectFolder"

export const SCRIPTS_DIR = "scripts"

/** The packages a project script may import: the editor's own copies, so a script's `Script` is the engine's `Script`. */
export const editorModules: Record<string, object> = {
  "@nickpaustian/catalyst": catalyst,
  "@nickpaustian/catalyst/input": input,
  "@nickpaustian/catalyst/interaction": interaction,
  "@nickpaustian/catalyst/physics": physics,
  "@nickpaustian/catalyst/prefabs": prefabs,
  "@nickpaustian/catalyst/resources": resources,
  "@nickpaustian/catalyst/splats": splats,
  three,
}

const SHIMS_GLOBAL = "__catalystScriptModules"
const IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\2/g
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/** A starting script for a project, named after its class. */
export const scriptTemplate = (className: string): string => `import { Script, type FrameData, type Node3D } from "@nickpaustian/catalyst"
import { Quaternion, Vector3 } from "three"

const UP = new Vector3(0, 1, 0)
const step = new Quaternion()

export default class ${className} extends Script<Node3D> {
  static exposed = [{ key: "speed", label: "Speed", type: "number" as const, step: 0.1 }]
  speed = 1

  protected onUpdate({ dt }: FrameData) {
    this.node.transform.rotation.multiply(step.setFromAxisAngle(UP, this.speed * dt))
  }
}
`

const dirname = (path: string): string => path.slice(0, path.lastIndexOf("/") + 1)

const normalise = (path: string): string => {
  const out: string[] = []
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") out.pop()
    else out.push(part)
  }
  return out.join("/")
}

/**
 * Builds a project's scripts in the browser: each `.ts` file is read from
 * the folder, stripped of its types, its imports of the engine and three
 * pointed at the editor's own copies and its relative imports at the other
 * files it names, and loaded as a module from a blob URL. Modules are kept
 * until `invalidate`.
 */
export class ScriptCompiler {
  private readonly folder: ProjectFolder
  private readonly modules: Record<string, object>
  private readonly built = new Map<string, Promise<string>>()
  private readonly shims = new Map<string, string>()

  constructor(folder: ProjectFolder, modules: Record<string, object> = editorModules) {
    this.folder = folder
    this.modules = modules
    ;(globalThis as any)[SHIMS_GLOBAL] = modules
  }

  /** The loader to give `engine.scripts`. */
  get loader(): ScriptLoader {
    return (url) => this.load(url)
  }

  async load(url: string): Promise<ScriptModule> {
    const blob = await this.build(normalise(url), [])
    return import(/* @vite-ignore */ blob) as Promise<ScriptModule>
  }

  /** Forget every built module (or one), so the next load reads the files again. */
  invalidate(path?: string): void {
    const drop = (key: string) => {
      const pending = this.built.get(key)
      this.built.delete(key)
      void pending?.then((blob) => URL.revokeObjectURL(blob)).catch(() => undefined)
    }
    if (path === undefined) for (const key of [...this.built.keys()]) drop(key)
    else drop(normalise(path))
  }

  private build(path: string, chain: string[]): Promise<string> {
    let pending = this.built.get(path)
    if (pending) return pending
    if (chain.includes(path)) return Promise.reject(new Error(`${path} imports itself through ${chain.join(" → ")}`))
    pending = this.compile(path, [...chain, path])
    pending.catch(() => this.built.delete(path))
    this.built.set(path, pending)
    return pending
  }

  private async compile(path: string, chain: string[]): Promise<string> {
    let source: string
    try {
      source = await this.folder.readText(path)
    } catch {
      throw new Error(`${path} is not in the project`)
    }
    let code: string
    try {
      code = transform(source, { transforms: ["typescript"], disableESTransforms: true, keepUnusedImports: true, filePath: path }).code
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(message.includes(path) ? message : `${path}: ${message}`)
    }
    const specifiers = new Map<string, string>()
    for (const match of code.matchAll(IMPORT)) specifiers.set(match[3], "")
    for (const specifier of specifiers.keys()) specifiers.set(specifier, await this.resolve(specifier, path, chain))
    const rewritten = code.replace(IMPORT, (_, lead: string, quote: string, specifier: string) => `${lead}${quote}${specifiers.get(specifier)}${quote}`)
    return URL.createObjectURL(new Blob([`${rewritten}\n//# sourceURL=${path}`], { type: "text/javascript" }))
  }

  private async resolve(specifier: string, from: string, chain: string[]): Promise<string> {
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
      const base = normalise(specifier.startsWith("/") ? specifier : dirname(from) + specifier)
      for (const candidate of [base, `${base}.ts`, `${base}.js`, `${base}/index.ts`]) if (await this.folder.exists(candidate)) return this.build(candidate, chain)
      throw new Error(`${from} imports ${specifier}, which is not in the project`)
    }
    if (specifier in this.modules) return this.shim(specifier)
    throw new Error(`${from} imports ${specifier}; a script may import ${Object.keys(this.modules).join(", ")} or the project's own files`)
  }

  private shim(name: string): string {
    let url = this.shims.get(name)
    if (url) return url
    const module = this.modules[name]
    const names = Object.keys(module).filter((key) => key !== "default" && IDENTIFIER.test(key))
    const lines = [`const m = globalThis[${JSON.stringify(SHIMS_GLOBAL)}][${JSON.stringify(name)}];`, ...names.map((key) => `export const ${key} = m[${JSON.stringify(key)}];`)]
    if ("default" in module) lines.push("export default m.default;")
    url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/javascript" }))
    this.shims.set(name, url)
    return url
  }
}
