import "@vitrine/runtime/styles.scss"
import { createLightspeedApp } from "@lightspeed-js/core"
import { components } from "virtual:lightspeed/components"
import { Player, assets } from "@vitrine/runtime"

interface CatalogueEntry {
  id: string
  title: string
  description?: string
  manifest: string
}

interface Catalogue {
  exhibitions: CatalogueEntry[]
}

const CATALOGUE_URL = new URL("exhibitions/index.json", window.location.href)
const PARAM = "exhibition"

declare global {
  interface Window {
    player?: Player
    assets?: typeof assets
    openExhibition?: (id: string) => Promise<void>
  }
}

const loadCatalogue = async (): Promise<Catalogue> => {
  const response = await fetch(CATALOGUE_URL)
  if (!response.ok) {
    throw new Error(`Failed to load catalogue (${response.status})`)
  }
  return (await response.json()) as Catalogue
}

const requestedId = () => new URLSearchParams(window.location.search).get(PARAM)

document.addEventListener("DOMContentLoaded", async () => {
  const catalogue = await loadCatalogue()
  const player = new Player()

  // The catalogue is a Lightspeed island over the canvas; it reads the entries
  // from a cell and drops the visitor's choice into another
  const app = createLightspeedApp()
  app.useComponents(components)
  window.lightspeed = app
  app.shared("catalogue:entries").set(catalogue.exhibitions)
  app.shared("catalogue:current").set(null)
  app.shared("catalogue:open").set(true)
  await app.mount("catalogue", "#catalogue")

  const open = async (id: string) => {
    const entry = catalogue.exhibitions.find((e) => e.id === id)
    if (!entry) throw new Error(`No exhibition "${id}" in the catalogue`)
    app.shared("catalogue:open").set(false)
    await player.load(new URL(entry.manifest, CATALOGUE_URL).href)
    app.shared("catalogue:current").set(id)
  }

  // Swapping exhibitions is a URL change, so back/forward work and links share
  window.openExhibition = async (id: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set(PARAM, id)
    history.pushState(null, "", url)
    await open(id)
  }
  window.addEventListener("popstate", () => {
    const id = requestedId()
    if (id) void open(id)
    else app.shared("catalogue:open").set(true)
  })

  app.shared("catalogue:choice").subscribe((choice) => {
    const id = (choice as { id?: string } | null)?.id
    if (!id) return
    if (id === app.shared("catalogue:current").value) {
      app.shared("catalogue:open").set(false)
      return
    }
    void window.openExhibition?.(id)
  })

  if (__DEBUG__) {
    window.player = player
    window.assets = assets
  }

  const id = requestedId()
  if (id) await open(id)
})
