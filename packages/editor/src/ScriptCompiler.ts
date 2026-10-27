import type { ScriptLoader, ScriptModule } from "@nickpaustian/catalyst"
import * as catalyst from "@nickpaustian/catalyst"
import * as input from "@nickpaustian/catalyst/input"
import * as interaction from "@nickpaustian/catalyst/interaction"
import * as physics from "@nickpaustian/catalyst/physics"
import * as prefabs from "@nickpaustian/catalyst/prefabs"
import * as resources from "@nickpaustian/catalyst/resources"
import * as obelisk from "@nickpaustian/obelisk"
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
  "@nickpaustian/obelisk": obelisk,
}

const REQUIRE = /\brequire\((["'])([^"'\n]+)\1\)/g

/** A project file compiled to a function of `require`, `exports` and `module`, with what each of its requires names. */
interface Compiled {
  run: (require: (specifier: string) => unknown, exports: object, module: { exports: object }) => void
  /** Specifier → a project file's path, or the name of one of the editor's packages. */
  requires: Map<string, string>
}

/** A starting script for a project, named after its class. */
export const scriptTemplate = (className: string): string => `import { Quaternion, Script, Vector3, type FrameData, type Node3D } from "@nickpaustian/catalyst"

const UP = new Vector3(0, 1, 0)
const step = new Quaternion()

export default class ${className} extends Script<Node3D> {
  static exposed = [{ key: "speed", label: "Speed", type: "number" as const, step: 0.1 }]
  speed = 1

  protected onUpdate({ dt }: FrameData) {
    this.node.transform.rotation.multiplyBy(step.setFromAxisAngle(UP, this.speed * dt))
  }
}
`

/** A script with nothing in it yet, for a node that needs one to hold its connections or signals. */
export const plainScriptTemplate = (className: string): string => `import { Script, type Node3D } from "@nickpaustian/catalyst"

export default class ${className} extends Script<Node3D> {
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
 * Builds a project's scripts in the browser: each `.ts` file is read from the
 * folder, stripped of its types and its imports turned into `require` calls,
 * and run through a registry of modules, as Node runs CommonJS. Imports read
 * through each module's `exports`, so they stay live, and files may import
 * each other in a cycle: a module still running when it is required again
 * gives what it has exported so far. The engine's and the renderer's packages
 * are the editor's own copies. Compiled files and their exports are kept until
 * `invalidate`.
 */
export class ScriptCompiler {
  private readonly folder: ProjectFolder
  private readonly modules: Record<string, object>
  private readonly compiled = new Map<string, Promise<Compiled>>()
  private readonly ready = new Map<string, Compiled>()
  private readonly evaluated = new Map<string, { exports: object }>()
  private readonly packages = new Map<string, object>()

  constructor(folder: ProjectFolder, modules: Record<string, object> = editorModules) {
    this.folder = folder
    this.modules = modules
  }

  /** The loader to give `engine.scripts`. */
  get loader(): ScriptLoader {
    return (url) => this.load(url)
  }

  async load(url: string): Promise<ScriptModule> {
    const path = normalise(url)
    await this.prepare(path)
    return this.evaluate(path) as ScriptModule
  }

  /**
   * Forget every compiled file (or one) and every module's exports, so the next load reads the files again and
   * runs them afresh: a module holding another's old exports would otherwise outlive the change.
   */
  invalidate(path?: string): void {
    if (path === undefined) {
      this.compiled.clear()
      this.ready.clear()
    } else {
      this.compiled.delete(normalise(path))
      this.ready.delete(normalise(path))
    }
    this.evaluated.clear()
  }

  /** Compiles a file and everything it requires, at any depth; each file once, so a cycle ends where it began. */
  private async prepare(entry: string): Promise<void> {
    const seen = new Set<string>()
    const visit = async (path: string): Promise<void> => {
      if (seen.has(path)) return
      seen.add(path)
      const compiled = await this.compile(path)
      await Promise.all([...compiled.requires.values()].filter((target) => !(target in this.modules)).map(visit))
    }
    await visit(entry)
  }

  private compile(path: string): Promise<Compiled> {
    let pending = this.compiled.get(path)
    if (!pending) {
      pending = this.compileFile(path).then((compiled) => {
        if (this.compiled.get(path) === pending) this.ready.set(path, compiled)
        return compiled
      })
      pending.catch(() => {
        if (this.compiled.get(path) === pending) this.compiled.delete(path)
      })
      this.compiled.set(path, pending)
    }
    return pending
  }

  private async compileFile(path: string): Promise<Compiled> {
    let source: string
    try {
      source = await this.folder.readText(path)
    } catch {
      throw new Error(`${path} is not in the project`)
    }
    let code: string
    try {
      code = transform(source, { transforms: ["typescript", "imports"], disableESTransforms: true, filePath: path }).code
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(message.includes(path) ? message : `${path}: ${message}`)
    }
    const requires = new Map<string, string>()
    for (const match of code.matchAll(REQUIRE)) if (!requires.has(match[2])) requires.set(match[2], await this.resolve(match[2], path))
    let run: Compiled["run"]
    try {
      run = (0, eval)(`(function (require, exports, module) {${code}\n})\n//# sourceURL=${path}`)
    } catch (error) {
      throw new Error(`${path}: ${error instanceof Error ? error.message : error}`)
    }
    return { run, requires }
  }

  /** A file's exports, running it the first time it is asked for; while it is still running, what it has so far. */
  private evaluate(path: string): object {
    const done = this.evaluated.get(path)
    if (done) return done.exports
    const compiled = this.ready.get(path)
    if (!compiled) throw new Error(`${path} was not compiled`)
    const module = { exports: {} as object }
    this.evaluated.set(path, module)
    const require = (specifier: string): unknown => {
      const target = compiled.requires.get(specifier)
      if (target === undefined) throw new Error(`${path} requires ${specifier}, which it does not import`)
      return target in this.modules ? this.package(target) : this.evaluate(target)
    }
    try {
      compiled.run(require, module.exports, module)
    } catch (error) {
      this.evaluated.delete(path)
      throw error
    }
    return module.exports
  }

  /** One of the editor's packages as a module's exports: marked as an ES module, so its default and names read as written. */
  private package(name: string): object {
    let exported = this.packages.get(name)
    if (!exported) {
      exported = Object.freeze({ ...this.modules[name], __esModule: true })
      this.packages.set(name, exported)
    }
    return exported
  }

  private async resolve(specifier: string, from: string): Promise<string> {
    if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
      const base = normalise(specifier.startsWith("/") ? specifier : dirname(from) + specifier)
      for (const candidate of [base, `${base}.ts`, `${base}.js`, `${base}/index.ts`]) if (await this.folder.exists(candidate)) return candidate
      throw new Error(`${from} imports ${specifier}, which is not in the project`)
    }
    if (specifier in this.modules) return specifier
    if (specifier === "three" || specifier.startsWith("three/")) throw new Error(`${from} imports ${specifier}, which the engine no longer uses: import Vector3, Quaternion and Mat4 from "@nickpaustian/catalyst" instead`)
    throw new Error(`${from} imports ${specifier}; a script may import ${Object.keys(this.modules).join(", ")} or the project's own files`)
  }
}
