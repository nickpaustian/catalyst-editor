import "@nickpaustian/catalyst-editor/styles.scss"
import { createLightspeedApp } from "@lightspeed-js/core"
import { components } from "virtual:lightspeed/components"
import { EditorSession, PaneLayout, browserFolders, createEngine, preferences, sceneRecipe, type Recipe } from "@nickpaustian/catalyst-editor"
import { desktop } from "./desktop"

const recipes: Recipe[] = [sceneRecipe]

document.addEventListener("DOMContentLoaded", async () => {
  const app = createLightspeedApp()
  app.useComponents(components)
  ;(window as any).lightspeed = app
  preferences.init()

  const panes = new PaneLayout({
    root: document.getElementById("layout")!,
    kinds: {
      scene: { title: "Scene", element: document.getElementById("scene-panel")! },
      viewport: { title: "Viewport", element: document.getElementById("app")! },
      inspector: { title: "Inspector", element: document.getElementById("editor-panel")! },
      code: { title: "Code", element: document.getElementById("code-panel")! },
    },
    layout: preferences.layout,
    onChange: preferences.setLayout,
  })
  ;(window as any).panes = panes

  if (!(await app.mount("scenepane", "#scene-panel"))) throw new Error("ScenePane did not mount")
  if (!(await app.mount("editorpanel", "#editor-panel"))) throw new Error("EditorPanel did not mount")
  if (!(await app.mount("menubar", "#menu-bar"))) throw new Error("MenuBar did not mount")
  if (!(await app.mount("codepane", "#code-panel"))) throw new Error("CodePane did not mount")
  if (!(await app.mount("startscreen", "#start-screen"))) throw new Error("StartScreen did not mount")
  if (!(await app.mount("projectdialog", "#project-dialog"))) throw new Error("ProjectDialog did not mount")
  app.shared("editor:code").subscribe((code: { path: string | null } | undefined) => {
    if (code?.path) panes.open("code", "viewport")
  })

  const recipe = recipes.find((r) => r.name === new URLSearchParams(location.search).get("recipe")) ?? recipes[0]
  const engine = createEngine(recipe, { container: "#app" })
  engine.start()

  const shell = await desktop()
  const folders = shell?.folders ?? browserFolders
  const session = new EditorSession({ app, engine, recipe, folders, runner: shell?.runnerLink })
  if (shell) {
    app.shared("editor:startMode").set("off")
    app.shared("editor:project").subscribe((project: { open: boolean } | undefined) => shell.showEditor(project?.open ?? false))
    shell.onProjectChosen((transfer) => void session.open(folders.fromTransfer(transfer)))
    shell.onStartClosed(() => {
      if (!session.root) shell.quit()
    })
  }
  for (const id of recipe.panel ?? []) {
    const host = document.createElement("div")
    document.getElementById("recipe-sections")!.appendChild(host)
    await app.mount(id, host)
  }
  Object.assign(window, { engine, session, folders })
})
