import { dataKind, exposedProperties, type Catalyst, type DataClass, type ExposedProperty } from "@nickpaustian/catalyst"
import { History } from "./History"
import type { ProjectFolder } from "./ProjectFolder"

type Json = Record<string, unknown>
type Path = (string | number)[]
type Described = Omit<ExposedProperty, "key"> & { key?: string }

/** One line of a data file's form: a field, a list, a nested object, or an entry of a list. */
export interface DataRow {
  /** The row's path in the file, joined, for keys. */
  id: string
  path: Path
  depth: number
  label: string
  /** `field` holds a value; `list` and `object` head what is under them; `item` heads an entry of a list. */
  row: "field" | "list" | "object" | "item"
  type: string
  value?: unknown
  options?: string[]
  step?: number
  min?: number
  max?: number
  /** For a `ref`: the files it may name, and the names to show them by. */
  choices?: { path: string; name: string }[]
  /** For a `ref`: the name of the file it names now. */
  display?: string
  /** For an object, or a list of objects: the kinds it may be. */
  kinds?: string[]
  /** For an object or an entry of objects: the kind it is now, "" for none. */
  kind?: string
  /** For a list: how many entries. */
  count?: number
  /** For an entry: whether it can move up or down. */
  first?: boolean
  last?: boolean
}

/** The data file open in the inspector: its path, its class, its rows, and what the last edit said. */
export interface DataView {
  path: string
  /** The file's name, without its folder or `.json`. */
  name: string
  type: string
  className: string
  rows: DataRow[]
  status: string
  /** Whether the status is a mistake in the file rather than news of a save. */
  problem: boolean
  canUndo: boolean
  canRedo: boolean
}

export interface DataEditingOptions {
  engine: Catalyst
  folder: () => ProjectFolder | null
  /** The project's files, for a `ref`'s choices. */
  files: () => string[]
  publish: (view: DataView | null) => void
}

/** Whether a file's contents are a data file: an object naming a script's class as its `type`. */
export const isDataFile = (json: unknown): boolean => {
  const type = (json as Json | null)?.type
  return typeof type === "string" && /\.(ts|js)(#[\w$]+)?$/.test(type)
}

const fileName = (path: string): string => path.replace(/^.*\//, "").replace(/\.json$/i, "")

/** A key as words: `listenZones` reads "Listen zones". */
const words = (key: string): string => {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const at = (json: unknown, path: Path): unknown => path.reduce<unknown>((node, key) => (node as Record<string | number, unknown> | null)?.[key], json)

/** What a new entry of a list starts as. */
const blank = (of: Described, kind?: string): unknown => {
  switch (of.type) {
    case "number":
      return 0
    case "boolean":
      return false
    case "data":
      return kind ? { type: kind } : null
    case "ref":
      return null
    case "list":
    case "flags":
      return []
  }
  return ""
}

/**
 * Editing a data file in the inspector: its class's exposed fields as rows, nested objects and lists opened out,
 * every change written to the file at once. The file is edited as it is saved (an option's name, a flag's name, a
 * file's path), so what the form shows is what the file says; a field the file leaves out shows the class's own value.
 * Changes have their own undo while the file is open, apart from the scene's.
 */
export class DataEditing {
  private file: { path: string; json: Json } | null = null
  private history = new History()
  private status = ""
  private problem = false
  private readonly defaults = new Map<DataClass, object>()
  private readonly options: DataEditingOptions

  constructor(options: DataEditingOptions) {
    this.options = options
  }

  get path(): string | null {
    return this.file?.path ?? null
  }

  async open(path: string): Promise<void> {
    const folder = this.options.folder()
    if (!folder) return
    const json = JSON.parse(await folder.readText(path)) as Json
    this.file = { path, json }
    this.history = new History()
    this.status = ""
    this.problem = false
    await this.publish()
  }

  close(): void {
    this.file = null
    this.options.publish(null)
  }

  /** The file changed on disk: read it again, unless that was this editor writing it. */
  async reloadFromDisk(): Promise<void> {
    const file = this.file
    const folder = this.options.folder()
    if (!file || !folder) return
    const text = await folder.readText(file.path)
    if (text === this.text(file.json)) return
    file.json = JSON.parse(text) as Json
    this.status = "reloaded from disk"
    await this.publish()
  }

  set(path: Path, value: unknown): Promise<void> {
    return this.change(`Set ${path.join(".")}`, (json) => this.put(json, path, value), path.join("."))
  }

  add(path: Path, kind?: string): Promise<void> {
    return this.change(`Add to ${path.join(".")}`, async (json) => {
      const list = (at(json, path) as unknown[] | undefined) ?? []
      const property = await this.propertyAt(path)
      this.put(json, path, [...list, blank(property?.of ?? { type: "string" }, kind)])
    })
  }

  remove(path: Path): Promise<void> {
    return this.change(`Remove ${path.join(".")}`, (json) => {
      const list = at(json, path.slice(0, -1)) as unknown[]
      list.splice(Number(path[path.length - 1]), 1)
    })
  }

  move(path: Path, by: number): Promise<void> {
    return this.change(`Move ${path.join(".")}`, (json) => {
      const list = at(json, path.slice(0, -1)) as unknown[]
      const from = Number(path[path.length - 1])
      const to = from + by
      if (to < 0 || to >= list.length) return
      ;[list[from], list[to]] = [list[to], list[from]]
    })
  }

  /** A nested object becomes another kind, keeping what the two kinds share; "" takes it away. */
  setKind(path: Path, kind: string): Promise<void> {
    return this.change(`Change ${path.join(".")}`, (json) => {
      const old = (at(json, path) as Json | null) ?? {}
      this.put(json, path, kind ? { ...old, type: kind } : null)
    })
  }

  undo(): Promise<void> {
    return this.step(() => this.history.undo())
  }

  redo(): Promise<void> {
    return this.step(() => this.history.redo())
  }

  private async step(move: () => boolean): Promise<void> {
    if (move()) await this.write()
  }

  private put(json: Json, path: Path, value: unknown): void {
    const parent = at(json, path.slice(0, -1)) as Record<string | number, unknown>
    parent[path[path.length - 1]] = value
  }

  private async change(label: string, apply: (json: Json) => void | Promise<void>, key?: string): Promise<void> {
    const file = this.file
    if (!file) return
    const before = structuredClone(file.json)
    await apply(file.json)
    const after = structuredClone(file.json)
    this.history.push({ label, undo: () => void (file.json = structuredClone(before)), redo: () => void (file.json = structuredClone(after)), key })
    await this.write()
  }

  /** Writes the file, then reads it back through the engine's data store, so a mistake shows against the field it is in. */
  private async write(): Promise<void> {
    const file = this.file
    const folder = this.options.folder()
    if (!file || !folder) return
    await folder.writeText(file.path, this.text(file.json))
    this.options.engine.data.invalidate(file.path)
    try {
      await this.options.engine.data.load(file.path)
      this.status = `saved ${file.path}`
      this.problem = false
    } catch (error) {
      this.status = error instanceof Error ? error.message : String(error)
      this.problem = true
    }
    await this.publish()
  }

  private text(json: Json): string {
    return `${JSON.stringify(json, null, 2)}\n`
  }

  private async publish(): Promise<void> {
    const file = this.file
    if (!file) return this.options.publish(null)
    let rows: DataRow[] = []
    let className = ""
    try {
      const cls = await this.options.engine.data.classOf(file.json.type as string, file.path)
      className = cls.name
      rows = await this.rowsOf(cls, file.json, [], 0)
    } catch (error) {
      this.status = error instanceof Error ? error.message : String(error)
      this.problem = true
    }
    this.options.publish({ path: file.path, name: fileName(file.path), type: file.json.type as string, className, rows, status: this.status, problem: this.problem, canUndo: this.history.canUndo, canRedo: this.history.canRedo })
  }

  /** A class's value for a field, as a file would save it: the form's stand-in for a field the file leaves out. */
  private defaultOf(cls: DataClass, property: ExposedProperty): unknown {
    let made = this.defaults.get(cls)
    if (!made) this.defaults.set(cls, (made = new cls()))
    const value = (made as Json)[property.key]
    if (property.type === "select" && property.values) return property.options?.[property.values.indexOf(value)] ?? ""
    if (property.type === "flags") return (property.options ?? []).filter((_, i) => (Number(value) & Number(property.values?.[i] ?? 1 << i)) !== 0)
    if (property.type === "ref" || property.type === "data") return value ? "(set in code)" : null
    return value
  }

  private async kindsOf(property: Described): Promise<{ name: string; cls: DataClass }[]> {
    const classes = await Promise.all((property.kinds ?? []).map((kind) => this.options.engine.data.classOf(kind)))
    return classes.map((cls) => ({ name: dataKind(cls), cls }))
  }

  private async rowsOf(cls: DataClass, json: Json, path: Path, depth: number): Promise<DataRow[]> {
    const rows: DataRow[] = []
    for (const property of exposedProperties(cls)) {
      if (property.hidden) continue
      const key = [...path, property.key]
      const label = property.label ?? words(property.key)
      const value = property.key in json ? json[property.key] : this.defaultOf(cls, property)
      rows.push(...(await this.rowsFor(property, label, value, key, depth)))
    }
    return rows
  }

  private async rowsFor(property: Described, label: string, value: unknown, path: Path, depth: number): Promise<DataRow[]> {
    const id = path.join(".")
    const base = { id, path, depth, label, type: property.type }
    if (property.type === "list") {
      const of = property.of ?? { type: "string" }
      const kinds = of.type === "data" ? (await this.kindsOf(of)).map((kind) => kind.name) : undefined
      const items = Array.isArray(value) ? value : []
      const rows: DataRow[] = [{ ...base, row: "list", count: items.length, kinds, kind: kinds?.[0] }]
      for (let i = 0; i < items.length; i++) {
        const entry = [...path, i]
        const edges = { first: i === 0, last: i === items.length - 1 }
        if (of.type === "data") rows.push(...(await this.objectRows(of, items[i] as Json | null, entry, depth + 1, `${i + 1}`, "item", edges)))
        else rows.push({ ...(await this.rowsFor(of, `${i + 1}`, items[i], entry, depth + 1))[0], row: "item", ...edges })
      }
      return rows
    }
    if (property.type === "data") return this.objectRows(property, value as Json | null, path, depth, label, "object")
    const row: DataRow = { ...base, row: "field", value, options: property.options, step: property.step, min: property.min, max: property.max }
    if (property.type === "ref") {
      row.choices = this.options
        .files()
        .filter((file) => file.endsWith(".json") && (!property.folder || file.startsWith(`${property.folder}/`)))
        .map((path) => ({ path, name: fileName(path) }))
      row.display = typeof value === "string" ? fileName(value) : ""
    }
    return [row]
  }

  private async objectRows(property: Described, json: Json | null, path: Path, depth: number, label: string, row: "object" | "item", edges = {}): Promise<DataRow[]> {
    const kinds = await this.kindsOf(property)
    const value = json && typeof json === "object" ? json : null
    const kind = value ? (kinds.find((k) => k.name === value.type) ?? (kinds.length === 1 ? kinds[0] : undefined)) : undefined
    const head: DataRow = { id: path.join("."), path, depth, label, row, type: "data", kinds: kinds.map((k) => k.name), kind: value ? (kind?.name ?? String(value.type ?? "")) : "", ...edges }
    return kind && value ? [head, ...(await this.rowsOf(kind.cls, value, path, depth + 1))] : [head]
  }

  private async propertyAt(path: Path): Promise<Described | null> {
    const file = this.file
    if (!file) return null
    let cls = await this.options.engine.data.classOf(file.json.type as string)
    let json: unknown = file.json
    let property: Described | null = null
    for (const key of path) {
      if (typeof key === "number") {
        property = (property as Described | null)?.of ?? null
        json = (json as unknown[])[key]
        if (property?.type === "data") {
          const kinds = await this.kindsOf(property)
          cls = (kinds.find((k) => k.name === (json as Json)?.type) ?? kinds[0]).cls
        }
        continue
      }
      property = exposedProperties(cls).find((p) => p.key === key) ?? null
      json = (json as Json)?.[key]
      if (property?.type === "data" && json) {
        const kinds = await this.kindsOf(property)
        cls = (kinds.find((k) => k.name === (json as Json).type) ?? kinds[0]).cls
      }
    }
    return property
  }
}
