import type { FolderSource, FolderTransfer, RunnerLink, RunnerPageLink } from "@nickpaustian/catalyst-editor"

export interface DesktopShell {
  folders: FolderSource
  runnerLink: RunnerLink
  runnerPageLink: RunnerPageLink
  /** The editor window: shown while a project is open, hidden behind the start window otherwise. */
  showEditor(open: boolean): void
  /** From the start window: a project chosen; the editor window opens it. */
  projectChosen(transfer: FolderTransfer): void
  onProjectChosen(listener: (transfer: FolderTransfer) => void): void
  /** From the start window: closed with nothing open, so the app quits. */
  startClosed(): void
  onStartClosed(listener: () => void): void
}

/** The desktop shell's folders and runner window when the page runs inside Tauri, else null. */
export const desktop = async (): Promise<DesktopShell | null> => {
  if (!("__TAURI_INTERNALS__" in window)) return null
  document.documentElement.classList.add("shell", navigator.userAgent.includes("Macintosh") ? "shell-macos" : "shell-other")
  const { tauriShell } = await import("./tauri")
  return tauriShell()
}
