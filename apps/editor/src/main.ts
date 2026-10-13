import "@vitrine/runtime/styles.scss"
import "./editor.scss"
import { createLightspeedApp } from "@lightspeed-js/core"
import { components } from "virtual:lightspeed/components"
import { Player, assets, type ExhibitionManifest } from "@vitrine/runtime"
import { Catalyst } from "@vitrine/catalyst"
import { EditorSession, type CatalogueEntry } from "./EditorSession"
import { ExhibitionFolder } from "./ExhibitionFolder"

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
  // Component ids are the file names lowercased; the PascalCase tag name mounts
  // nothing and says nothing
  const panel = await app.mount("editorpanel", "#editor-panel")
  if (!panel) throw new Error("EditorPanel did not mount")

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
  session = new EditorSession({
    app,
    exhibition,
    catalogue: catalogue.exhibitions,
    onSwitch: switchTo,
    onOpenFolder: openFolder,
  })
  window.editor = session
})
