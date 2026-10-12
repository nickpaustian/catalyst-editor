import "@vitrine/runtime/styles.scss"
import "./editor.scss"
import { Player, assets } from "@vitrine/runtime"
import { EditorPanel } from "./EditorPanel"

interface CatalogueEntry {
  id: string
  title: string
  manifest: string
}

const CATALOGUE_URL = new URL("exhibitions/index.json", window.location.href)
const PARAM = "exhibition"

declare global {
  interface Window {
    player?: Player
    assets?: typeof assets
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const response = await fetch(CATALOGUE_URL)
  const catalogue = (await response.json()) as { exhibitions: CatalogueEntry[] }
  const requested = new URLSearchParams(window.location.search).get(PARAM)
  const entry = requested
    ? catalogue.exhibitions.find((e) => e.id === requested)
    : catalogue.exhibitions[0]
  if (!entry) throw new Error(`No exhibition "${requested ?? ""}" in the catalogue`)

  const player = new Player()
  window.player = player
  window.assets = assets

  const exhibition = await player.load(new URL(entry.manifest, CATALOGUE_URL).href)
  new EditorPanel(exhibition, catalogue.exhibitions, (id) => {
    const url = new URL(window.location.href)
    url.searchParams.set(PARAM, id)
    window.location.href = url.href
  })
})
