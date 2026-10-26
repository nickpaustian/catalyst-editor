import { ROOT_PATH, exposedProperties, isVariant, mergeVariant, overridesOf, readExposed, variantOf, type Catalyst, type ExposedProperty, type Node, type NodeJSON, type NodeOverride, type ScriptClass, type VariantJSON } from "@nickpaustian/catalyst"

/** What the inspector shows of the selected node in a variant: whether the base has it, and what this file changes over the base. */
export interface VariantView {
  base: string
  inherited: boolean
  transform: boolean
  fields: string[]
  /** By the script's place on the node. */
  scripts: { index: number; inherited: boolean; fields: string[] }[]
}

interface Editing {
  base: string
  json: NodeJSON
  /** The base's tree, built once and kept out of the scene, to compare against. */
  tree: Node
  paths: Set<string>
  overrides: Record<string, NodeOverride> | null
}

const pathsIn = (json: NodeJSON): Set<string> => {
  const paths = new Set<string>([ROOT_PATH])
  const visit = (node: NodeJSON, path: string) => {
    for (const child of node.children ?? []) {
      const at = path === ROOT_PATH ? `${child.name}` : `${path}/${child.name}`
      paths.add(at)
      visit(child, at)
    }
  }
  visit(json, ROOT_PATH)
  return paths
}

/**
 * The file being edited when it is a variant: the base it is made from, which of the tree's
 * nodes and scripts come from that base, what the file changes over it, and the base's value of a
 * field to reset one to. Saving writes only the changes and additions.
 */
export class VariantEditing {
  private editing: Editing | null = null
  private readonly engine: Catalyst

  constructor(engine: Catalyst) {
    this.engine = engine
  }

  /** The base file of the variant being edited, or null when the file isn't one. */
  get base(): string | null {
    return this.editing?.base ?? null
  }

  /** The tree to edit from what a file holds: a variant made whole over its base (read through `read`), anything else as it is. */
  async open(json: NodeJSON | VariantJSON, path: string, read: (path: string) => Promise<NodeJSON | VariantJSON>): Promise<NodeJSON> {
    this.close()
    if (!isVariant(json)) return json
    const whole = async (url: string, chain: string[]): Promise<NodeJSON> => {
      if (chain.includes(url)) throw new Error(`${[...chain, url].join(" → ")} is made from itself`)
      const file = await read(url)
      return isVariant(file) ? mergeVariant(await whole(file.base, [...chain, url]), file) : file
    }
    const base = await whole(json.base, [path])
    this.editing = { base: json.base, json: base, tree: this.engine.create(base), paths: pathsIn(base), overrides: null }
    return mergeVariant(base, json)
  }

  close(): void {
    this.editing?.tree.dispose()
    this.editing = null
  }

  /** The tree as the variant file keeps it. */
  save(root: Node): VariantJSON | null {
    const editing = this.editing
    return editing ? variantOf(this.engine, editing.json, root, editing.base, editing.tree) : null
  }

  /** Something changed: what the file overrides is worked out again when next asked. */
  stale(): void {
    if (this.editing) this.editing.overrides = null
  }

  isInherited(node: Node, root: Node): boolean {
    return this.editing?.paths.has(pathOf(node, root)) ?? false
  }

  /** Whether the script at `index` on the node is one the base gives it: the first of each url, as many as the base has. */
  isInheritedScript(node: Node, index: number, root: Node): boolean {
    const json = this.baseJSON(node, root)
    if (!json) return false
    const urls = [...node.scripts.map((script) => script.url), ...node.pendingScripts.map((entry) => entry.url)]
    const url = urls[index]
    const before = urls.slice(0, index).filter((other) => other === url).length
    return before < (json.scripts ?? []).filter((entry) => entry.url === url).length
  }

  view(node: Node, root: Node): VariantView | null {
    const editing = this.editing
    if (!editing) return null
    const inherited = this.isInherited(node, root)
    const override = inherited ? this.overrides(root)[pathOf(node, root)] : undefined
    const urls = [...node.scripts.map((script) => script.url), ...node.pendingScripts.map((entry) => entry.url)]
    const shown = new Set<string>()
    return {
      base: editing.base,
      inherited,
      transform: Boolean(override?.transform),
      fields: [...Object.keys(override?.options ?? {}), ...Object.keys(override?.properties ?? {})],
      scripts: urls.map((url, index) => {
        const fromBase = inherited && this.isInheritedScript(node, index, root)
        const first = fromBase && !shown.has(url)
        if (first) shown.add(url)
        return { index, inherited: fromBase, fields: first ? Object.keys(override?.scriptFields?.[url] ?? {}) : [] }
      }),
    }
  }

  /** The nodes the base gives, and those of them the file changes. */
  marks(root: Node, nodes: Node[]): { inherited: Node[]; overridden: Node[] } | null {
    if (!this.editing) return null
    const overrides = this.overrides(root)
    const inherited = nodes.filter((node) => this.isInherited(node, root))
    const overridden = inherited.filter((node) => {
      const override = overrides[pathOf(node, root)]
      return override && (override.options || override.properties || override.transform || override.tags || override.scriptFields)
    })
    return { inherited, overridden }
  }

  /** The base's copy of a node, to read a field's value back from. */
  baseNode(node: Node, root: Node): Node | null {
    const editing = this.editing
    if (!editing || !this.isInherited(node, root)) return null
    const path = pathOf(node, root)
    if (path === ROOT_PATH) return editing.tree
    let at: Node | undefined = editing.tree
    for (const name of path.split("/")) at = at?.getChildren().find((child) => !child.internal && child.name === name)
    return at ?? null
  }

  /** The base's value of a field of the node's script at `index`: what its file gives, or the script's own default. */
  baseScriptValue(node: Node, index: number, property: ExposedProperty, root: Node): { value: unknown } | null {
    const script = node.scripts[index]
    if (!script || !this.isInheritedScript(node, index, root)) return null
    const entry = this.baseJSON(node, root)?.scripts?.find((candidate) => candidate.url === script.url)
    if (entry?.properties && property.key in entry.properties) return { value: structuredClone(entry.properties[property.key]) }
    if ("default" in property) return { value: property.default }
    const fresh = new (script.constructor as ScriptClass)()
    return { value: readExposed(fresh, exposedProperties(fresh).find((p) => p.key === property.key) ?? property) }
  }

  private overrides(root: Node): Record<string, NodeOverride> {
    const editing = this.editing!
    editing.overrides ??= overridesOf(this.engine, editing.json, root, editing.tree)
    return editing.overrides
  }

  private baseJSON(node: Node, root: Node): NodeJSON | null {
    const editing = this.editing
    if (!editing) return null
    const path = pathOf(node, root)
    if (path === ROOT_PATH) return editing.json
    let at: NodeJSON | undefined = editing.json
    for (const name of path.split("/")) at = at?.children?.find((child) => child.name === name)
    return at ?? null
  }
}

/** A node's place under the root as the variant's overrides name it. */
const pathOf = (node: Node, root: Node): string => {
  const names: string[] = []
  for (let at: Node | null = node; at && at !== root; at = at.parent) names.unshift(at.name)
  return names.length ? names.join("/") : ROOT_PATH
}
