import "@vitrine/editor/styles.scss"
import { createLightspeedApp } from "@lightspeed-js/core"
import { components } from "virtual:lightspeed/components"
import { Catalyst, DebugShapes } from "@nickpaustian/catalyst"
import { Input } from "@nickpaustian/catalyst/input"
import { Interaction } from "@nickpaustian/catalyst/interaction"
import { Physics } from "@nickpaustian/catalyst/physics"
import { Resources } from "@nickpaustian/catalyst/resources"
import { Splats } from "@nickpaustian/catalyst/splats"
import { HemisphereLight } from "three"
import { EditorSession, PaneLayout, ProjectFolder, preferences, sceneRecipe, type Recipe } from "@vitrine/editor"

const recipes: Recipe[] = [sceneRecipe]

document.addEventListener("DOMContentLoaded", async () => {
  const app = createLightspeedApp()
  app.useComponents(components)
  ;(window as any).lightspeed = app
  preferences.init()

  const panes = new PaneLayout({
    root: document.getElementById("layout")!,
    kinds: {
      viewport: { title: "Viewport", element: document.getElementById("app")! },
      panel: { title: "Editor", element: document.getElementById("editor-panel")! },
    },
    layout: preferences.layout,
    onChange: preferences.setLayout,
  })
  ;(window as any).panes = panes

  if (!(await app.mount("editorpanel", "#editor-panel"))) throw new Error("EditorPanel did not mount")
  if (!(await app.mount("menubar", "#menu-bar"))) throw new Error("MenuBar did not mount")

  const recipe = recipes.find((r) => r.name === new URLSearchParams(location.search).get("recipe")) ?? recipes[0]
  const engine = new Catalyst({
    container: "#app",
    background: 0x15181d,
    pixelRatio: 2,
    log: (message, tag) => console.debug(`[${tag ?? "catalyst"}] ${message}`),
    modules: [new Physics({ gravity: 9.8 }), new Input(), new Interaction(), new Resources(), new Splats({ capacity: 500_000 }), ...(recipe.modules?.() ?? [])],
  })
  engine.scene.add(new HemisphereLight(0xffffff, 0x334455, 2))
  engine.scene.add(DebugShapes.grid({ size: 40, colour: 0x2a2f3a }))
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
