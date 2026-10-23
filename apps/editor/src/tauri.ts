import { nativeFolders, type NativeFs, type RunMessage, type RunnerLink, type RunnerPageLink } from "@nickpaustian/catalyst-editor"
import { open } from "@tauri-apps/plugin-dialog"
import { exists, mkdir, readDir, readFile, readTextFile, remove, writeFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { emitTo, listen } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import type { DesktopShell } from "./desktop"

const RUNNER_LABEL = "runner"
const MAIN_LABEL = "main"

const fs: NativeFs = {
  pickDirectory: async () => {
    const picked = await open({ directory: true, multiple: false, title: "Open a Catalyst project" })
    return typeof picked === "string" ? picked : null
  },
  exists: (path) => exists(path),
  readText: (path) => readTextFile(path),
  readBinary: (path) => readFile(path),
  writeText: (path, text) => writeTextFile(path, text),
  writeBinary: (path, data) => writeFile(path, data),
  readDir: async (path) => (await readDir(path)).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory })),
  mkdir: (path) => mkdir(path, { recursive: true }),
  remove: (path) => remove(path, { recursive: true }),
}

/** The runner as a second Tauri window, spoken to with Tauri events rather than `postMessage`. */
const runnerLink = (): RunnerLink => {
  let runner: WebviewWindow | null = null
  return {
    get isOpen() {
      return runner !== null
    },
    open(url) {
      const target = new URL(url)
      runner = new WebviewWindow(RUNNER_LABEL, { url: `${target.pathname}${target.search}`, title: "Catalyst · running", width: 1280, height: 800 })
      void runner.once("tauri://destroyed", () => (runner = null))
      void runner.once("tauri://error", () => (runner = null))
      return true
    },
    focus() {
      void runner?.setFocus()
    },
    send(message) {
      void emitTo(RUNNER_LABEL, "catalyst:run", message)
    },
    onReady(listener) {
      const pending = listen("catalyst:ready", () => listener())
      return () => void pending.then((unlisten) => unlisten())
    },
  }
}

const runnerPageLink = (): RunnerPageLink => ({
  ready() {
    void emitTo(MAIN_LABEL, "catalyst:ready", null)
  },
  onRun(listener) {
    const pending = listen<RunMessage>("catalyst:run", (event) => listener(event.payload))
    return () => void pending.then((unlisten) => unlisten())
  },
})

export const tauriShell = (): DesktopShell => ({ folders: nativeFolders(fs), runnerLink: runnerLink(), runnerPageLink: runnerPageLink() })
