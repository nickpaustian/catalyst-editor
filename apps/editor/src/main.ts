import "@nickpaustian/catalyst-editor/styles.scss"
import { createLightspeedApp } from "@lightspeed-js/core"
import { components } from "virtual:lightspeed/components"
import { EditorSession, PaneLayout, browserFolders, createEngine, preferences, projectFolderOfFile, sceneRecipe, tokens, type FolderSource, type Recipe } from "@nickpaustian/catalyst-editor"
import { desktop } from "./desktop"

const recipes: Recipe[] = [sceneRecipe]
const PLUS_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>`

/** Dev builds reload often, so the page comes back to the project it had; a folder whose permission needs a click is left to the start screen. */
const reopenLast = async (session: EditorSession, folders: FolderSource) => {
  const last = await folders.last()
  if (!last) return
  const allowed = await last.ensurePermission().catch(() => false)
  if (allowed) await session.open(last)
}

document.addEventListener("DOMContentLoaded", async () => {
  const app = createLightspeedApp()
  app.useComponents(components)
  ;(window as any).lightspeed = app
  preferences.init()

  const panes = new PaneLayout({
    root: document.getElementById("layout")!,
    kinds: {
      scene: {
        title: "Scene",
        element: document.getElementById("scene-panel")!,
        actions: [{ label: "Add node (⌘⇧A)", icon: PLUS_ICON, run: () => app.shared("editor:addDialog").set(true) }],
      },
      viewport: { title: "Viewport", element: document.getElementById("app")! },
      inspector: { title: "Inspector", element: document.getElementById("editor-panel")! },
      environment: { title: "Environment", element: document.getElementById("environment-panel")! },
      code: { title: "Code", element: document.getElementById("code-panel")! },
      files: {
        title: "Files",
        element: document.getElementById("files-panel")!,
        actions: [{ label: "Import file…", icon: PLUS_ICON, run: () => app.shared("editor:command").set({ type: "importAsset", seq: Math.random() }) }],
      },
    },
    layout: preferences.layout,
    onChange: preferences.setLayout,
  })
  ;(window as any).panes = panes

  if (!(await app.mount("scenepane", "#scene-panel"))) throw new Error("ScenePane did not mount")
  if (!(await app.mount("editorpanel", "#editor-panel"))) throw new Error("EditorPanel did not mount")
  if (!(await app.mount("environmentpane", "#environment-panel"))) throw new Error("EnvironmentPane did not mount")
  if (!(await app.mount("menubar", "#menu-bar"))) throw new Error("MenuBar did not mount")
  if (!(await app.mount("codepane", "#code-panel"))) throw new Error("CodePane did not mount")
  if (!(await app.mount("filespane", "#files-panel"))) throw new Error("FilesPane did not mount")
  if (!(await app.mount("startscreen", "#start-screen"))) throw new Error("StartScreen did not mount")
  if (!(await app.mount("projectdialog", "#project-dialog"))) throw new Error("ProjectDialog did not mount")
  if (!(await app.mount("contextmenu", "#context-menu"))) throw new Error("ContextMenu did not mount")
  if (!(await app.mount("confirmdialog", "#confirm-dialog"))) throw new Error("ConfirmDialog did not mount")
  if (!(await app.mount("streamabledialog", "#streamable-dialog"))) throw new Error("StreamableDialog did not mount")
  if (!(await app.mount("filepicker", "#file-picker"))) throw new Error("FilePicker did not mount")
  if (!(await app.mount("viewporttools", "#viewport-tools"))) throw new Error("ViewportTools did not mount")
  app.shared("editor:code").subscribe((code: { path: string | null } | undefined) => {
    if (code?.path) panes.open("code", "viewport")
  })

  const recipe = recipes.find((r) => r.name === new URLSearchParams(location.search).get("recipe")) ?? recipes[0]
  const engine = createEngine(recipe, { container: "#app", background: parseInt(tokens.color.bg.viewport.slice(1), 16) })
  engine.start()

  const shell = await desktop()
  const folders = shell?.folders ?? browserFolders
  const session = new EditorSession({ app, engine, recipe, folders, runner: shell?.runnerLink, converter: shell?.converter })
  if (shell) {
    app.shared("editor:startMode").set("off")
    let shown: boolean | null = null
    app.shared("editor:project").subscribe((project: { open: boolean } | undefined) => {
      const open = project?.open ?? false
      if (open === shown) return
      shown = open
      shell.showEditor(open)
    })
    shell.onProjectChosen((transfer) => void session.open(folders.fromTransfer(transfer)))
    shell.onStartClosed(() => {
      if (!session.root) shell.quit()
    })
    const openFile = async (paths: string[]) => {
      const file = paths[paths.length - 1]
      if (file) await session.open(folders.fromTransfer({ kind: "path", path: projectFolderOfFile(file) }))
    }
    shell.onOpenedFiles((paths) => void (async () => {
      await shell.takeOpenedFiles()
      await openFile(paths)
    })())
    await openFile(await shell.takeOpenedFiles())
  }
  if (import.meta.env.DEV && !session.root) await reopenLast(session, folders)
  for (const id of recipe.panel ?? []) {
    const host = document.createElement("div")
    document.getElementById("recipe-sections")!.appendChild(host)
    await app.mount(id, host)
  }
  // Files dragged from the files pane land in the scene: a model or a theca is placed, an hdr becomes the environment; files from outside are imported.
  const viewport = document.getElementById("app")!
  const command = (c: Record<string, unknown>) => app.shared("editor:command").set({ ...c, seq: Math.random() })
  viewport.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return
    if (event.dataTransfer.types.includes("text/catalyst-file") || event.dataTransfer.types.includes("Files")) {
      event.preventDefault()
      event.dataTransfer.dropEffect = "copy"
    }
  })
  viewport.addEventListener("drop", (event) => {
    const transfer = event.dataTransfer
    if (!transfer) return
    const path = transfer.getData("text/catalyst-file")
    if (path) {
      event.preventDefault()
      if (/\.(glb|gltf)$/i.test(path)) command({ type: "addModel", path })
      else if (/\.theca$/i.test(path)) command({ type: "addTheca", path })
      else if (/\.hdr$/i.test(path)) command({ type: "useEnvironment", path })
      return
    }
    if (transfer.files.length) {
      event.preventDefault()
      command({ type: "importDropped", files: [...transfer.files] })
    }
  })
  Object.assign(window, { engine, session, folders })
})
