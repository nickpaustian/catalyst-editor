import type { FolderSource, RunnerLink, RunnerPageLink } from "@nickpaustian/catalyst-editor"

export interface DesktopShell {
  folders: FolderSource
  runnerLink: RunnerLink
  runnerPageLink: RunnerPageLink
}

/** The desktop shell's folders and runner window when the page runs inside Tauri, else null. */
export const desktop = async (): Promise<DesktopShell | null> => {
  if (!("__TAURI_INTERNALS__" in window)) return null
  const { tauriShell } = await import("./tauri")
  return tauriShell()
}
