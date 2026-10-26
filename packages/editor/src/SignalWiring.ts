import { Node, Node3D, connectableMethods, declaredConnections, declaredSignals, nodesNamed, signalAt, signalsOf, type Catalyst, type Connection, type Script } from "@nickpaustian/catalyst"
import { addEntry, addMethod, changeEntry, hasMethod, readEntry, staticArray, writeEntry } from "./scriptSource"

/** A connection as the inspector lists it: who listens, to what, and why it doesn't work, if it doesn't. */
export interface ConnectionRow {
  /** The script file that declares it, and its place in that file's `static connections`; null when a base class in another file declares it. */
  url: string
  index: number | null
  /** The listening node. */
  node: number
  nodeName: string
  from?: string
  /** The node `from` finds, when it finds one. */
  source: number | null
  signal: string
  call: string
  problem: string | null
}

export interface SignalRow {
  name: string
  description?: string
  payload?: string
  /** The script file that adds it to the node, and its place in that file's `static signals`; null for the class's own. */
  url: string | null
  index: number | null
  /** One every node has (`onEnter`, `onChildAdded`…), listed last. */
  common: boolean
  listeners: ConnectionRow[]
}

/** The signals panel for one node: what it emits and who hears each, and what its scripts listen to. */
export interface SignalsView {
  node: number
  name: string
  signals: SignalRow[]
  listens: ConnectionRow[]
  scripts: { url: string; name: string }[]
}

/** Every connection and declared signal in the scene, and the engine's signals with who hears them, for the signals pane. */
export interface SignalBrowser {
  connections: ConnectionRow[]
  declared: { node: number; nodeName: string; name: string; url: string; listeners: number }[]
  engine: { group: string | null; signals: { name: string; description?: string; payload?: string; listeners: ConnectionRow[] }[] }[]
}

export const BROWSER_DEFAULT: SignalBrowser = { connections: [], declared: [], engine: [] }

/** A node the connect dialog offers, with its signals and its scripts' methods. */
export interface ConnectNode {
  id: number
  label: string
  signals: string[]
  scripts: { url: string; name: string; methods: string[]; shared: number }[]
}

/** What the Connect dialog shows: a signal from a node (or the engine) to a method on a node's script, one side chosen already. */
export interface ConnectDialog {
  open: boolean
  /** "emit": the source node and signal are given and a listener is chosen; "listen": the listening node is given and a source is chosen. */
  mode: "emit" | "listen"
  source: number | null
  signal: string
  target: number | null
  nodes: ConnectNode[]
  /** The engine's signals, dotted for a group. */
  engine: { name: string; description?: string }[]
  error: string
}

export const CONNECT_DEFAULT: ConnectDialog = { open: false, mode: "emit", source: null, signal: "", target: null, nodes: [], engine: [], error: "" }

/** What the wiring needs from the session. */
export interface WiringHost {
  readonly engine: Catalyst
  root(): Node3D | null
  idOf(node: Node): number
  nodeById(id: number): Node3D | null
  /** Change a script file through `edit`, which gives back the new text or null when it cannot; resolves once the scripts are rebuilt from it. */
  editScript(url: string, edit: (source: string) => string | null): Promise<void>
  /** Make a script for `node` named after it and attach it; gives back its url. */
  newScriptFor(node: Node3D): Promise<string | null>
}

const fileName = (url: string) => url.replace(/^.*\//, "")

/** The name a scene node is reached by from scripts, the scene's root left out. */
const labelOf = (node: Node, root: Node): string => {
  const parts: string[] = []
  for (let at: Node | null = node; at && at !== root; at = at.parent) parts.unshift(at.name)
  return parts.join("/")
}

/**
 * Signals in the editor, kept in code: the selected node's signals and who
 * hears them, read from the live scripts; and connections and signals
 * written into scripts' `static connections` and `static signals`.
 */
export class SignalWiring {
  private readonly host: WiringHost

  constructor(host: WiringHost) {
    this.host = host
  }

  /** The shortest `from` that finds `source` from a script on `listener`: ".", its name, or as much of its path as tells it apart. */
  fromFor(source: Node, listener: Node): string {
    if (source === listener) return "."
    const root = this.host.root()
    if (!root) return source.name
    const parts = labelOf(source, root).split("/")
    for (let take = 1; take <= parts.length; take++) {
      const from = parts.slice(-take).join("/")
      if (nodesNamed(root, from, listener).length === 1) return from
    }
    return parts.join("/")
  }

  /** Every connection declared by scripts in the scene, with where it is written. */
  private connections(): { node: Node3D; script: Script; connection: Connection; url: string; index: number | null }[] {
    const root = this.host.root()
    const out: { node: Node3D; script: Script; connection: Connection; url: string; index: number | null }[] = []
    root?.walk((node) => {
      if (!(node instanceof Node3D)) return
      for (const script of node.scripts) {
        const cls = script.constructor as typeof Script
        const own = Object.prototype.hasOwnProperty.call(cls, "connections") ? cls.connections : []
        for (const connection of declaredConnections(script)) {
          const index = own.indexOf(connection)
          out.push({ node, script, connection, url: script.url, index: index < 0 ? null : index })
        }
      }
    })
    return out
  }

  private row(entry: { node: Node3D; script: Script; connection: Connection; url: string; index: number | null }): ConnectionRow {
    const { node, script, connection } = entry
    const root = this.host.root()
    const found = connection.from === undefined || !root ? [] : nodesNamed(root, connection.from, node)
    const source = found[0] ?? null
    let problem: string | null = null
    if (typeof (script as unknown as Record<string, unknown>)[connection.call] !== "function") problem = `${fileName(entry.url)} has no method ${connection.call}`
    else if (connection.from !== undefined && !source) problem = `no node "${connection.from}"`
    else if (found.length > 1) problem = `${found.length} nodes are named "${connection.from}"; the first is heard`
    else if (!signalAt(source ? source.signals : this.host.engine.signals, connection.signal)) problem = `no signal ${connection.signal} on ${source ? `"${connection.from}"` : "the engine"}`
    return { url: entry.url, index: entry.index, node: this.host.idOf(node), nodeName: node.name, from: connection.from, source: source ? this.host.idOf(source) : null, signal: connection.signal, call: connection.call, problem }
  }

  view(node: Node3D): SignalsView {
    const root = this.host.root()
    const all = this.connections()
    const heard = all.filter((entry) => {
      if (entry.connection.from === undefined || !root) return false
      return nodesNamed(root, entry.connection.from, entry.node)[0] === node
    })
    const common = new Set(declaredSignals(Node).map((info) => info.name))
    const signals: SignalRow[] = signalsOf(node).map((info) => {
      const declaring = node.scripts.find((script) => declaredSignals(script).some((declared) => declared.name === info.name) && !declaredSignals(node).some((own) => own.name === info.name))
      const own = declaring && Object.prototype.hasOwnProperty.call(declaring.constructor, "signals") ? ((declaring.constructor as typeof Script).signals ?? []) : []
      const index = own.findIndex((declared) => declared.name === info.name)
      return {
        name: info.name,
        description: info.description,
        payload: info.payload,
        url: declaring?.url ?? null,
        index: declaring && index >= 0 ? index : null,
        common: common.has(info.name) && !declaring,
        listeners: heard.filter((entry) => entry.connection.signal === info.name).map((entry) => this.row(entry)),
      }
    })
    const rank = (row: SignalRow) => (row.url ? 0 : row.common ? 2 : 1)
    return {
      node: this.host.idOf(node),
      name: node.name,
      signals: signals.sort((a, b) => rank(a) - rank(b)),
      listens: all.filter((entry) => entry.node === node).map((entry) => this.row(entry)),
      scripts: node.scripts.map((script) => ({ url: script.url, name: fileName(script.url) })),
    }
  }

  browser(): SignalBrowser {
    const root = this.host.root()
    if (!root) return BROWSER_DEFAULT
    const rows = this.connections().map((entry) => ({ entry, row: this.row(entry) }))
    const declared: SignalBrowser["declared"] = []
    root.walk((node) => {
      if (!(node instanceof Node3D)) return
      for (const script of node.scripts) {
        const own = Object.prototype.hasOwnProperty.call(script.constructor, "signals") ? ((script.constructor as typeof Script).signals ?? []) : []
        for (const info of own) {
          const listeners = rows.filter(({ entry, row }) => row.signal === info.name && entry.connection.from !== undefined && nodesNamed(root, entry.connection.from, entry.node)[0] === node).length
          declared.push({ node: this.host.idOf(node), nodeName: labelOf(node, root), name: info.name, url: script.url, listeners })
        }
      }
    })
    const engine = this.host.engine.signalCatalog().map((group) => ({
      group: group.group,
      signals: group.signals.map((info) => {
        const name = group.group ? `${group.group}.${info.name}` : info.name
        return { ...info, listeners: rows.filter(({ entry, row }) => entry.connection.from === undefined && row.signal === name).map(({ row }) => row) }
      }),
    }))
    return { connections: rows.map(({ row }) => row), declared, engine }
  }

  /** The Connect dialog's choices: every node with its signals and scripts, and the engine's signals. */
  dialog(mode: ConnectDialog["mode"], node: Node3D, signal: string): ConnectDialog {
    const root = this.host.root()
    const uses = new Map<string, number>()
    root?.walk((each) => {
      for (const script of each.scripts) uses.set(script.url, (uses.get(script.url) ?? 0) + 1)
    })
    const nodes: ConnectNode[] = []
    root?.walk((each) => {
      if (each === root || !(each instanceof Node3D)) return
      nodes.push({
        id: this.host.idOf(each),
        label: labelOf(each, root),
        signals: signalsOf(each).map((info) => info.name),
        scripts: each.scripts.map((script) => ({ url: script.url, name: fileName(script.url), methods: connectableMethods(script), shared: uses.get(script.url) ?? 1 })),
      })
    })
    const engine = this.host.engine.signalCatalog().flatMap((group) => group.signals.map((info) => ({ name: group.group ? `${group.group}.${info.name}` : info.name, description: info.description })))
    const id = this.host.idOf(node)
    return mode === "emit"
      ? { open: true, mode, source: id, signal, target: null, nodes, engine, error: "" }
      : { open: true, mode, source: null, signal: "", target: id, nodes, engine, error: "" }
  }

  /** Write a connection into the listening script: made for the node when it has none, and the method added when it is new. */
  async connect(choice: { source: number | null; signal: string; target: number; url: string | null; call: string }): Promise<void> {
    const target = this.host.nodeById(choice.target)
    if (!target) throw new Error("the listening node is gone")
    const source = choice.source === null ? null : this.host.nodeById(choice.source)
    if (choice.source !== null && !source) throw new Error("the node with the signal is gone")
    const call = choice.call.trim()
    if (!/^[A-Za-z_$][\w$]*$/.test(call)) throw new Error(`"${call}" is not a method name`)
    const url = choice.url ?? (await this.host.newScriptFor(target))
    if (!url) throw new Error("no script could be made for the node")
    const from = source ? this.fromFor(source, target) : undefined
    await this.host.editScript(url, (text) => {
      const connected = addEntry(text, "connections", writeEntry({ from, signal: choice.signal, call }))
      if (connected === null) return null
      return hasMethod(connected, call) ? connected : addMethod(connected, call)
    })
  }

  async disconnect(url: string, index: number): Promise<void> {
    await this.host.editScript(url, (text) => changeEntry(text, "connections", index, null))
  }

  /** A signal declared in a script on the node, which is made for it when it has none. */
  async addSignal(nodeId: number, url: string | null, name: string): Promise<void> {
    const node = this.host.nodeById(nodeId)
    if (!node) throw new Error("the node is gone")
    const clean = name.trim()
    if (!/^[A-Za-z_$][\w$]*$/.test(clean)) throw new Error(`"${clean}" is not a signal name`)
    if (signalsOf(node).some((info) => info.name === clean)) throw new Error(`"${node.name}" already has a signal ${clean}`)
    const into = url ?? node.scripts[0]?.url ?? (await this.host.newScriptFor(node))
    if (!into) throw new Error("no script could be made for the node")
    await this.host.editScript(into, (text) => addEntry(text, "signals", writeEntry({ name: clean })))
  }

  async removeSignal(url: string, index: number): Promise<void> {
    await this.host.editScript(url, (text) => changeEntry(text, "signals", index, null))
  }

  /** The written connections that hear `node`, by file and place, to point at it again after it is renamed. */
  referencesTo(node: Node3D): { url: string; index: number; listener: Node3D }[] {
    const root = this.host.root()
    if (!root) return []
    return this.connections()
      .filter((entry) => entry.index !== null && entry.connection.from !== undefined && entry.connection.from !== "." && nodesNamed(root, entry.connection.from, entry.node)[0] === node)
      .map((entry) => ({ url: entry.url, index: entry.index!, listener: entry.node }))
  }

  /** Rewrite each reference's `from` to find `node` by what it is called now; a file shared by several listeners is written once per entry. */
  async retarget(references: { url: string; index: number; listener: Node3D }[], node: Node3D): Promise<void> {
    const byFile = new Map<string, Map<number, string>>()
    for (const reference of references) {
      const entries = byFile.get(reference.url) ?? new Map<number, string>()
      entries.set(reference.index, this.fromFor(node, reference.listener))
      byFile.set(reference.url, entries)
    }
    for (const [url, entries] of byFile) {
      await this.host.editScript(url, (text) => {
        let next: string | null = text
        for (const [index, from] of entries) {
          const array = next === null ? null : staticArray(next, "connections")
          if (!array || array === "unreadable" || !next) return null
          const entry = array.entries[index] ? readEntry<Connection>(array.entries[index].text) : null
          if (!entry) continue
          next = changeEntry(next, "connections", index, writeEntry({ from, signal: entry.signal, call: entry.call }))
        }
        return next
      })
    }
  }
}
