import "@vitrine/runtime/styles.scss"
import "./editor.scss"
import "./panes/panes.scss"
import { createLightspeedApp } from "@lightspeed-js/core"
import { components } from "virtual:lightspeed/components"
import { Player, assets, type ExhibitionManifest } from "@vitrine/runtime"
import { Catalyst } from "@vitrine/catalyst"
import { EditorSession, type CatalogueEntry } from "./EditorSession"
import { ExhibitionFolder } from "./ExhibitionFolder"
import { preferences } from "./preferences"
import { PaneLayout } from "./panes/PaneLayout"

const CATALOGUE_URL = new URL("exhibitions/index.json", window.location.href)
const PARAM = "exhibition"

declare global {
  interface Window {
    player?: Player
    assets?: typeof assets
    catalyst?: Catalyst
    openFolder?: (folder: ExhibitionFolder) => Promise<void>
    ExhibitionFolder?: typeof ExhibitionFolder
    editor?: EditorSession | null
    panes?: PaneLayout
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const response = await fetch(CATALOGUE_URL)
  const catalogue = (await response.json()) as { exhibitions: CatalogueEntry[] }
  const requested = new URLSearchParams(window.location.search).get(PARAM)

  // The panel is Lightspeed islands mounted once; the session feeds them
  // through shared cells and listens for their commands
  const app = createLightspeedApp()
  app.useComponents(components)
  window.lightspeed = app
  preferences.init()

  // The viewport and the panel are the two pane kinds; the layout adopts
  // their elements, so the canvas and the mounted panel survive rearranging
  const panes = new PaneLayout({
    root: document.getElementById("layout")!,
    kinds: {
      viewport: { title: "Viewport", element: document.getElementById("app")! },
      panel: { title: "Editor", element: document.getElementById("editor-panel")! },
    },
    layout: preferences.layout,
    onChange: preferences.setLayout,
  })
  window.panes = panes

  // Slate hangs its overlay (points of interest, modal) off <body>; in the
  // editor it belongs over the viewport pane
  const adoptOverlay = () => {
    const overlay = Catalyst._.ui?.canvas
    const viewport = panes.bodyOf("viewport")
    if (overlay && viewport && overlay.parentElement !== viewport) viewport.appendChild(overlay)
  }
  // Component ids are the file names lowercased; the PascalCase tag name mounts
  // nothing and says nothing
  const panel = await app.mount("editorpanel", "#editor-panel")
  if (!panel) throw new Error("EditorPanel did not mount")
  if (!(await app.mount("menubar", "#menu-bar"))) throw new Error("MenuBar did not mount")

  const player = new Player()
  window.player = player
  window.assets = assets
  window.ExhibitionFolder = ExhibitionFolder

  let session: EditorSession | null = null

  const switchTo = (id: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set(PARAM, id)
    window.location.href = url.href
  }

  const openFolder = async (folder: ExhibitionFolder) => {
    if (!(await folder.ensurePermission())) return
    const { raw, loaded } = await folder.load()
    session?.dispose()
    const exhibition = await player.loadManifest(loaded)
    window.catalyst = Catalyst._
    adoptOverlay()
    session = new EditorSession({
      app,
      exhibition,
      catalogue: catalogue.exhibitions,
      onSwitch: switchTo,
      onOpenFolder: openFolder,
      rawManifest: raw as ExhibitionManifest,
      folder,
    })
    window.editor = session
  }
  window.openFolder = openFolder

  // Reopening the last folder needs a click to re-grant access, so the
  // catalogue entry loads first and the folder is offered on the panel
  const entry = requested
    ? catalogue.exhibitions.find((e) => e.id === requested)
    : catalogue.exhibitions[0]
  if (!entry) throw new Error(`No exhibition "${requested ?? ""}" in the catalogue`)

  const exhibition = await player.load(new URL(entry.manifest, CATALOGUE_URL).href)
  window.catalyst = Catalyst._
  adoptOverlay()
  session = new EditorSession({
    app,
    exhibition,
    catalogue: catalogue.exhibitions,
    onSwitch: switchTo,
    onOpenFolder: openFolder,
  })
  window.editor = session
})
