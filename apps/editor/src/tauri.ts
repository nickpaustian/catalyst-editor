import { nativeFolders, type FolderTransfer, type NativeFs, type RunMessage, type RunnerLink, type RunnerPageLink } from "@nickpaustian/catalyst-editor"
import { open } from "@tauri-apps/plugin-dialog"
import { exists, mkdir, readDir, readFile, readTextFile, remove, watch, writeFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { invoke } from "@tauri-apps/api/core"
import { emitTo, listen } from "@tauri-apps/api/event"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { getCurrentWindow } from "@tauri-apps/api/window"
import type { DesktopShell } from "./desktop"

const RUNNER_LABEL = "runner"
const MAIN_LABEL = "main"
const START_LABEL = "start"

const startWindow = () => WebviewWindow.getByLabel(START_LABEL)

const showStart = async (): Promise<void> => {
  const start = await startWindow()
  await start?.show()
  await start?.setFocus()
}

const hideStart = async (): Promise<void> => {
  await (await startWindow())?.hide()
}

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
  initGit: (path) => invoke("init_git", { path }),
  watch: (path, listener) => watch(path, (event) => listener(event.paths), { recursive: true, delayMs: 250 }),
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

/** The start window is declared in the Tauri config and only ever shown or hidden; closing the editor window takes it along so the app exits. */
export const tauriShell = (): DesktopShell => {
  const current = getCurrentWindow()
  if (current.label === MAIN_LABEL) void current.onCloseRequested(async () => void (await startWindow())?.close())
  return shell()
}

const shell = (): DesktopShell => ({
  folders: nativeFolders(fs),
  runnerLink: runnerLink(),
  runnerPageLink: runnerPageLink(),
  showEditor(open) {
    const editor = getCurrentWindow()
    if (open) {
      void hideStart()
      void editor.show().then(() => editor.setFocus())
    } else {
      void editor.hide()
      void showStart()
    }
  },
  projectChosen(transfer) {
    void emitTo(MAIN_LABEL, "catalyst:open-project", transfer)
  },
  onProjectChosen(listener) {
    void listen<FolderTransfer>("catalyst:open-project", (event) => listener(event.payload))
  },
  startClosed() {
    void emitTo(MAIN_LABEL, "catalyst:start-closed", null)
  },
  onStartClosed(listener) {
    void listen("catalyst:start-closed", () => listener())
  },
  quit() {
    void (async () => {
      await (await startWindow())?.close().catch(() => undefined)
      await getCurrentWindow().close()
    })()
  },
  takeOpenedFiles: () => invoke<string[]>("take_opened_files"),
  onOpenedFiles(listener) {
    void listen<string[]>("catalyst:open-files", (event) => listener(event.payload))
  },
})
