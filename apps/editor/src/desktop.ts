import type { AssetConverter, FolderSource, FolderTransfer, RunnerLink, RunnerPageLink } from "@nickpaustian/catalyst-editor"

export interface DesktopShell {
  folders: FolderSource
  runnerLink: RunnerLink
  runnerPageLink: RunnerPageLink
  /** Show a file or folder, by absolute path, in the system's file manager, as `revealLabel` names it. */
  reveal(path: string): Promise<void>
  revealLabel: string
  /** Iapetus, run by the app, for making models streamable. */
  converter: AssetConverter
  /** The editor window: shown while a project is open, hidden behind the start window otherwise. */
  showEditor(open: boolean): void
  /** From the start window: a project chosen; the editor window opens it. */
  projectChosen(transfer: FolderTransfer): void
  onProjectChosen(listener: (transfer: FolderTransfer) => void): void
  /** From the start window: closed with nothing open, so the app quits. */
  startClosed(): void
  onStartClosed(listener: () => void): void
  /** Closing the editor window or quitting the app goes ahead only when `check` agrees. */
  guardClose(check: () => Promise<boolean>): void
  /** Close this window; with the start window gone too, the app exits. */
  quit(): void
  /** Project files the app was launched with, or opened while it runs, handed over once. */
  takeOpenedFiles(): Promise<string[]>
  onOpenedFiles(listener: (paths: string[]) => void): void
}

/** The desktop shell's folders and runner window when the page runs inside Tauri, else null. */
export const desktop = async (): Promise<DesktopShell | null> => {
  if (!("__TAURI_INTERNALS__" in window)) return null
  document.documentElement.classList.add("shell", navigator.userAgent.includes("Macintosh") ? "shell-macos" : "shell-other")
  const { tauriShell } = await import("./tauri")
  return tauriShell()
}
