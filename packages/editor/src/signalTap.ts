import { Node, isSignal, signalAt, type Catalyst } from "@nickpaustian/catalyst"

/** A signal that fired in a run: when (seconds into it), on which node (null: the engine), and what it carried, in words. */
export interface FiredSignal {
  at: number
  node: string | null
  signal: string
  value: string
}

/** Signals that fire every frame or step, left out of the log unless asked for so the rest can be read. */
export const FREQUENT_SIGNALS = new Set(["onUpdate", "onIdle", "onRender", "onPostRender", "physics.onStep", "input.onPointerMove", "input.onForceChanged", "input.onActionHold", "onTriggerStay", "onCollisionStay", "onMove"])

const FLUSH_MS = 100
const RESCAN_MS = 1000
const MOST_PER_FLUSH = 200

const labelOf = (node: Node, root: Node): string => {
  const parts: string[] = []
  for (let at: Node | null = node; at && at !== root; at = at.parent) parts.unshift(at.name)
  return parts.join("/") || node.name
}

/** What a signal carried, short: a node by its name, an object by its first few fields. */
export const describeValue = (value: unknown): string => {
  if (value === undefined) return ""
  if (value instanceof Node) return `"${value.name}"`
  if (typeof value !== "object" || value === null) return String(value)
  try {
    const text = JSON.stringify(value, (key, field) => (key && field instanceof Node ? field.name : key && typeof field === "object" && field !== null ? "{…}" : field))
    return text.length > 80 ? `${text.slice(0, 79)}…` : text
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/**
 * Hears every signal in a running scene (the engine's and each node's) and
 * hands them on in batches, for the editor's signal log. A signal is heard
 * by wrapping its `emit`, so nothing about what it does changes; the tree is
 * looked over again each second for nodes and signals that arrived since.
 */
export class SignalTap {
  private readonly root: Node
  private readonly send: (fired: FiredSignal[]) => void
  private readonly started = performance.now()
  private readonly wrapped = new Map<object, unknown>()
  private pending: FiredSignal[] = []
  private readonly timers: ReturnType<typeof setInterval>[] = []
  /** Whether the every-frame signals are reported too. */
  frequent = false

  constructor(engine: Catalyst, root: Node, send: (fired: FiredSignal[]) => void) {
    this.root = root
    this.send = send
    for (const group of engine.signalCatalog()) {
      for (const info of group.signals) {
        const name = group.group ? `${group.group}.${info.name}` : info.name
        const signal = signalAt(engine.signals, name)
        if (signal) this.wrap(signal, null, name)
      }
    }
    this.scan()
    this.timers.push(setInterval(() => this.scan(), RESCAN_MS), setInterval(() => this.flush(), FLUSH_MS))
  }

  private scan(): void {
    this.root.walk((node) => {
      const signals = node.signals as unknown as Record<string, unknown>
      for (const name of Object.keys(signals)) {
        const signal = signals[name]
        if (isSignal(signal)) this.wrap(signal, node, name)
      }
    })
  }

  private wrap(signal: { emit(value: unknown): void }, node: Node | null, name: string): void {
    if (this.wrapped.has(signal)) return
    const own = Object.prototype.hasOwnProperty.call(signal, "emit") ? signal.emit : undefined
    const emit = signal.emit
    const frequent = FREQUENT_SIGNALS.has(name)
    this.wrapped.set(signal, own)
    signal.emit = (value: unknown) => {
      if (!frequent || this.frequent) this.pending.push({ at: (performance.now() - this.started) / 1000, node: node ? labelOf(node, this.root) : null, signal: name, value: describeValue(value) })
      emit.call(signal, value)
    }
  }

  private flush(): void {
    if (!this.pending.length) return
    const fired = this.pending.length > MOST_PER_FLUSH ? this.pending.slice(-MOST_PER_FLUSH) : this.pending
    this.pending = []
    this.send(fired)
  }

  /** Stop hearing, and give each signal its own `emit` back. */
  dispose(): void {
    this.flush()
    for (const timer of this.timers) clearInterval(timer)
    for (const [signal, own] of this.wrapped) {
      const target = signal as { emit?: unknown }
      if (own === undefined) delete target.emit
      else target.emit = own
    }
    this.wrapped.clear()
  }
}
