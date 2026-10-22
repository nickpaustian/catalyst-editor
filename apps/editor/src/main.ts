import "@vitrine/editor/styles.scss"
import { createLightspeedApp } from "@lightspeed-js/core"
import { components } from "virtual:lightspeed/components"
import { EditorSession, PaneLayout, ProjectFolder, createEngine, preferences, sceneRecipe, type Recipe } from "@vitrine/editor"

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
    },
    layout: preferences.layout,
    onChange: preferences.setLayout,
  })
  ;(window as any).panes = panes

  if (!(await app.mount("scenepane", "#scene-panel"))) throw new Error("ScenePane did not mount")
  if (!(await app.mount("editorpanel", "#editor-panel"))) throw new Error("EditorPanel did not mount")
  if (!(await app.mount("menubar", "#menu-bar"))) throw new Error("MenuBar did not mount")

  const recipe = recipes.find((r) => r.name === new URLSearchParams(location.search).get("recipe")) ?? recipes[0]
  const engine = createEngine(recipe, { container: "#app" })
  engine.start()

  const session = new EditorSession({ app, engine, recipe })
  for (const id of recipe.panel ?? []) {
    const host = document.createElement("div")
    document.getElementById("recipe-sections")!.appendChild(host)
    await app.mount(id, host)
  }
  Object.assign(window, { engine, session, ProjectFolder })

  const last = ProjectFolder.isSupported ? await ProjectFolder.last() : null
  await session.open(null)
  if (last) (window as any).lightspeed.shared("editor:project").set({ name: null, recipe: recipe.name, status: `last folder: ${last.name}, use File → Reopen last`, supported: true, dirty: false })
})
