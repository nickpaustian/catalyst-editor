import type { NodeJSON } from "@nickpaustian/catalyst"
import type { FolderTransfer } from "./ProjectFolder"
import type { FiredSignal } from "./signalTap"
import type { ConsoleEntry } from "./consoleTap"

/** What the editor sends the runner: the scene as it is, and how to open the project it came from. */
export interface RunMessage {
  type: "catalyst:run"
  recipe: string
  scene: NodeJSON
  folder: FolderTransfer | null
}

/** How the runner should report while it plays, sent with each run and whenever it changes. */
export interface RunOptions {
  type: "catalyst:options"
  /** Report the signals that fire every frame too. */
  frequentSignals: boolean
}

/** What the runner tells the editor while a scene plays: the signals that fired, or what its console said, since the last report. */
export type RunReport = { type: "catalyst:signals"; fired: FiredSignal[] } | { type: "catalyst:console"; entries: ConsoleEntry[] }

export const RUN_REPORTS: RunReport["type"][] = ["catalyst:signals", "catalyst:console"]

/** The editor's side of the runner window: open it, hear that it is ready, send it scenes. */
export interface RunnerLink {
  readonly isOpen: boolean
  /** Open the runner page; false when the host would not. */
  open(url: string): boolean
  focus(): void
  close(): void
  send(message: RunMessage | RunOptions): void
  onReady(listener: () => void): () => void
  /** Hear that the runner window has gone, closed from either side. */
  onClosed(listener: () => void): () => void
  /** Hear that the host could not make the runner window, with its reason. */
  onFailed?(listener: (reason: string) => void): () => void
  /** Hear what the runner reports while it plays. */
  onReport?(listener: (report: RunReport) => void): () => void
}

/** The runner's side: say it is ready, hear scenes. */
export interface RunnerPageLink {
  ready(): void
  onRun(listener: (message: RunMessage) => void): () => void
  /** Hear how the editor wants reports made. */
  onOptions?(listener: (options: RunOptions) => void): () => void
  /** Tell the editor what happened while playing. */
  report?(report: RunReport): void
}

const RUNNER_NAME = "catalyst-run"

/** A browser window opened by name and spoken to with `postMessage`; one is reused across runs. */
export const windowRunnerLink = (): RunnerLink => {
  let runner: Window | null = null
  let watching: ReturnType<typeof setInterval> | undefined
  const closed = new Set<() => void>()
  // A window opened by script says nothing when it closes, so the editor looks
  const watch = () => {
    clearInterval(watching)
    watching = setInterval(() => {
      if (runner && !runner.closed) return
      clearInterval(watching)
      runner = null
      closed.forEach((listener) => listener())
    }, 500)
  }
  return {
    get isOpen() {
      return runner !== null && !runner.closed
    },
    open(url) {
      runner = window.open(url, RUNNER_NAME)
      if (runner) watch()
      return runner !== null
    },
    focus() {
      runner?.focus()
    },
    close() {
      runner?.close()
    },
    send(message) {
      if (runner && !runner.closed) runner.postMessage(message, location.origin)
    },
    onReady(listener) {
      const onMessage = (event: MessageEvent) => {
        if (event.origin === location.origin && event.data?.type === "catalyst:ready") listener()
      }
      window.addEventListener("message", onMessage)
      return () => window.removeEventListener("message", onMessage)
    },
    onClosed(listener) {
      closed.add(listener)
      return () => closed.delete(listener)
    },
    onReport(listener) {
      const onMessage = (event: MessageEvent) => {
        if (event.origin === location.origin && RUN_REPORTS.includes(event.data?.type)) listener(event.data as RunReport)
      }
      window.addEventListener("message", onMessage)
      return () => window.removeEventListener("message", onMessage)
    },
  }
}

export const windowRunnerPageLink = (): RunnerPageLink => ({
  ready() {
    window.opener?.postMessage({ type: "catalyst:ready" }, location.origin)
  },
  report(report) {
    window.opener?.postMessage(report, location.origin)
  },
  onOptions(listener) {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === location.origin && event.data?.type === "catalyst:options") listener(event.data as RunOptions)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  },
  onRun(listener) {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === location.origin && event.data?.type === "catalyst:run") listener(event.data as RunMessage)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  },
})
