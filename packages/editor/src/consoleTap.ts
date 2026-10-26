import { Node } from "@nickpaustian/catalyst"

/** One line of a run's console: when (seconds into the run), how serious, what it said, and where it was thrown. */
export interface ConsoleEntry {
  at: number
  level: "error" | "warn" | "log" | "info" | "debug" | "engine"
  text: string
  /** The engine's tag for its own messages, such as `script` or `resources`. */
  tag?: string
  stack?: string
  /** How many times in a row it was said, when more than once. */
  count?: number
}

const FLUSH_MS = 100
const MOST_PER_FLUSH = 300
const LONGEST = 2000
const LEVELS = ["error", "warn", "log", "info", "debug"] as const
/** The engine logs through `console.debug` as `[tag] message`. */
const ENGINE_LINE = /^\[([\w:-]+)\] ([\s\S]*)$/

const clip = (text: string) => (text.length > LONGEST ? `${text.slice(0, LONGEST - 1)}…` : text)

/** A value as the console would print it, short: a node by name, an error by its message, an object by its fields. */
export const describeArgument = (value: unknown): string => {
  if (typeof value === "string") return value
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (value instanceof Node) return `${value.constructor.name} "${value.name}"`
  if (typeof value !== "object" || value === null) return String(value)
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(value, (key, field) => {
      if (key && field instanceof Node) return `${field.constructor.name} "${field.name}"`
      if (typeof field === "object" && field !== null) {
        if (seen.has(field)) return "[circular]"
        seen.add(field)
      }
      return field
    })
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/**
 * The run window's console, heard and handed on in batches for the editor's
 * console pane: every `console` call (each still prints as it would), errors
 * nothing caught, and promises rejected with no one to hear it.
 */
export class ConsoleTap {
  private readonly send: (entries: ConsoleEntry[]) => void
  private pending: ConsoleEntry[] = []
  private started = performance.now()
  private readonly originals = new Map<(typeof LEVELS)[number], (...args: unknown[]) => void>()
  private readonly timer: ReturnType<typeof setInterval>
  private readonly onError = (event: ErrorEvent) => {
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : ""
    this.add({ level: "error", text: `Uncaught ${event.error instanceof Error ? describeArgument(event.error) : event.message}${event.error instanceof Error ? "" : where}`, stack: event.error instanceof Error ? event.error.stack : undefined })
  }
  private readonly onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason
    this.add({ level: "error", text: `Uncaught (in promise) ${describeArgument(reason)}`, stack: reason instanceof Error ? reason.stack : undefined })
  }

  constructor(send: (entries: ConsoleEntry[]) => void) {
    this.send = send
    for (const level of LEVELS) {
      const original = console[level].bind(console)
      this.originals.set(level, original)
      console[level] = (...args: unknown[]) => {
        original(...args)
        this.heard(level, args)
      }
    }
    window.addEventListener("error", this.onError)
    window.addEventListener("unhandledrejection", this.onRejection)
    this.timer = setInterval(() => this.flush(), FLUSH_MS)
  }

  private heard(level: (typeof LEVELS)[number], args: unknown[]): void {
    const error = args.find((arg): arg is Error => arg instanceof Error)
    const text = args.map(describeArgument).join(" ")
    const engine = level === "debug" ? ENGINE_LINE.exec(text) : null
    if (engine) this.add({ level: "engine", tag: engine[1], text: engine[2] })
    else this.add({ level, text, stack: error?.stack })
  }

  private add(entry: Omit<ConsoleEntry, "at">): void {
    this.pending.push({ ...entry, text: clip(entry.text), at: (performance.now() - this.started) / 1000 })
  }

  /** A run began: what is said from now is timed from it. */
  restart(): void {
    this.flush()
    this.started = performance.now()
  }

  private flush(): void {
    if (!this.pending.length) return
    const entries = this.pending.length > MOST_PER_FLUSH ? this.pending.slice(-MOST_PER_FLUSH) : this.pending
    this.pending = []
    this.send(entries)
  }

  /** Stop hearing, and give the console its own methods back. */
  dispose(): void {
    this.flush()
    clearInterval(this.timer)
    for (const [level, original] of this.originals) console[level] = original
    window.removeEventListener("error", this.onError)
    window.removeEventListener("unhandledrejection", this.onRejection)
  }
}
