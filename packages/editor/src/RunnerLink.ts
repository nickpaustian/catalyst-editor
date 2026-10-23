import type { NodeJSON } from "@nickpaustian/catalyst"
import type { FolderTransfer } from "./ProjectFolder"

/** What the editor sends the runner: the scene as it is, and how to open the project it came from. */
export interface RunMessage {
  type: "catalyst:run"
  recipe: string
  scene: NodeJSON
  folder: FolderTransfer | null
}

/** The editor's side of the runner window: open it, hear that it is ready, send it scenes. */
export interface RunnerLink {
  readonly isOpen: boolean
  /** Open the runner page; false when the host would not. */
  open(url: string): boolean
  focus(): void
  close(): void
  send(message: RunMessage): void
  onReady(listener: () => void): () => void
  /** Hear that the runner window has gone, closed from either side. */
  onClosed(listener: () => void): () => void
}

/** The runner's side: say it is ready, hear scenes. */
export interface RunnerPageLink {
  ready(): void
  onRun(listener: (message: RunMessage) => void): () => void
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
  }
}

export const windowRunnerPageLink = (): RunnerPageLink => ({
  ready() {
    window.opener?.postMessage({ type: "catalyst:ready" }, location.origin)
  },
  onRun(listener) {
    const onMessage = (event: MessageEvent) => {
      if (event.origin === location.origin && event.data?.type === "catalyst:run") listener(event.data as RunMessage)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  },
})
