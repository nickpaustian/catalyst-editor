import { nativeFolders, type FolderTransfer, type NativeFs, type RunMessage, type RunnerLink, type RunnerPageLink } from "@nickpaustian/catalyst-editor"
import { open } from "@tauri-apps/plugin-dialog"
import { exists, mkdir, readDir, readFile, readTextFile, remove, rename, stat, watch, writeFile, writeTextFile } from "@tauri-apps/plugin-fs"
import { invoke } from "@tauri-apps/api/core"
import { documentDir, homeDir } from "@tauri-apps/api/path"
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
  pickFile: async (extensions) => {
    const picked = await open({ multiple: false, directory: false, filters: extensions ? [{ name: "Accepted files", extensions }] : undefined })
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
  rename: (from, to) => rename(from, to),
  stat: async (path) => {
    const info = await stat(path)
    return { size: info.size, modified: info.mtime?.getTime() ?? 0 }
  },
  initGit: (path) => invoke("init_git", { path }),
  watch: (path, listener) => watch(path, (event) => listener(event.paths), { recursive: true, delayMs: 250 }),
  homeDir: () => homeDir(),
  documentsDir: () => documentDir(),
}

/** The runner as a second Tauri window, spoken to with Tauri events rather than `postMessage`. */
const runnerLink = (): RunnerLink => {
  let runner: WebviewWindow | null = null
  const closed = new Set<() => void>()
  const failed = new Set<(reason: string) => void>()
  const gone = () => {
    runner = null
    closed.forEach((listener) => listener())
  }
  return {
    get isOpen() {
      return runner !== null
    },
    open(url) {
      const target = new URL(url)
      const make = () => {
        const window = new WebviewWindow(RUNNER_LABEL, { url: `${target.pathname}${target.search}`, title: "Catalyst · running", width: 1280, height: 800 })
        runner = window
        void window.once("tauri://destroyed", () => {
          if (runner === window) gone()
        })
        void window.once("tauri://error", (event) => {
          const reason = typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload)
          console.error("[catalyst-editor] the run window could not be made:", reason)
          failed.forEach((listener) => listener(reason))
          if (runner === window) gone()
        })
      }
      // A run window left from before this page reloaded still holds the label, and a second one with it is refused: close it first.
      void WebviewWindow.getByLabel(RUNNER_LABEL)
        .then(async (existing) => {
          if (existing) {
            runner = null
            await existing.destroy().catch(() => undefined)
          }
          make()
        })
        .catch(make)
      return true
    },
    focus() {
      void runner?.setFocus()
    },
    close() {
      void runner?.destroy()
    },
    send(message) {
      void emitTo(RUNNER_LABEL, "catalyst:run", message)
    },
    onReady(listener) {
      const pending = listen("catalyst:ready", () => listener())
      return () => void pending.then((unlisten) => unlisten())
    },
    onClosed(listener) {
      closed.add(listener)
      return () => closed.delete(listener)
    },
    onFailed(listener) {
      failed.add(listener)
      return () => failed.delete(listener)
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
