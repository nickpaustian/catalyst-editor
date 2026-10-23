import "@nickpaustian/catalyst-editor/styles.scss"
import { createLightspeedApp } from "@lightspeed-js/core"
import { components } from "virtual:lightspeed/components"
import { browserFolders, type FolderSource, type ProjectFolder } from "@nickpaustian/catalyst-editor"
import { desktop } from "./desktop"

/**
 * The start screen as a window of its own, in the desktop app: it lists and
 * opens projects with no editor behind it, and hands the chosen folder to
 * the editor window, which then shows itself.
 */
document.addEventListener("DOMContentLoaded", async () => {
  const app = createLightspeedApp()
  app.useComponents(components)
  ;(window as any).lightspeed = app
  const shell = await desktop()
  const folders: FolderSource = shell?.folders ?? browserFolders
  const project = app.shared("editor:project")
  const recent = app.shared("editor:recent")
  app.shared("editor:startMode").set("window")
  const status = (text: string) => project.set({ open: false, name: null, recipe: "scene", storage: null, status: text, supported: folders.isSupported, browserStorage: folders.hasBrowserStorage, dirty: false })
  const refresh = async () => recent.set(await folders.recent())
  status("")
  await refresh()

  const chosen = async (folder: ProjectFolder | null) => {
    if (!folder || !(await folder.ensurePermission())) return
    await folder.remember()
    shell?.projectChosen(folder.transfer())
  }

  app.shared("editor:command").subscribe((command: any) => {
    if (!command) return
    void (async () => {
      switch (command.type) {
        case "newProject":
          if (folders.hasBrowserStorage) await chosen(await folders.inBrowser(String(command.name ?? "untitled")))
          else await chosen(await folders.pick())
          break
        case "openFolder":
          await chosen(await folders.pick())
          break
        case "openRecent": {
          const folder = await folders.openRecent(command.id)
          if (!folder) {
            await folders.forget(command.id)
            await refresh()
            status("that project is gone")
          } else await chosen(folder)
          break
        }
        case "forgetRecent":
          await folders.forget(command.id)
          await refresh()
          break
      }
    })()
  })

  if (!(await app.mount("startscreen", "#start-screen"))) throw new Error("StartScreen did not mount")
  if (shell) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window")
    void getCurrentWindow().onCloseRequested(() => shell.startClosed())
  }
})
