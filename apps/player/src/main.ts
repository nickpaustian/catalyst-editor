import "@vitrine/runtime/styles.scss"
import { Player } from "@vitrine/runtime"

interface CatalogueEntry {
  id: string
  title: string
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

const entryFor = (catalogue: Catalogue, id: string | null): CatalogueEntry => {
  const entry = id
    ? catalogue.exhibitions.find((e) => e.id === id)
    : catalogue.exhibitions[0]
  if (!entry) throw new Error(`No exhibition "${id ?? ""}" in the catalogue`)
  return entry
}

const requestedId = () => new URLSearchParams(window.location.search).get(PARAM)

document.addEventListener("DOMContentLoaded", async () => {
  const catalogue = await loadCatalogue()
  const player = new Player()

  const open = async (id: string | null) => {
    const entry = entryFor(catalogue, id)
    await player.load(new URL(entry.manifest, CATALOGUE_URL).href)
  }

  // Swapping exhibitions is a URL change, so back/forward work and links share
  window.openExhibition = async (id: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set(PARAM, id)
    history.pushState(null, "", url)
    await open(id)
  }
  window.addEventListener("popstate", () => void open(requestedId()))

  if (__DEBUG__) window.player = player

  await open(requestedId())
})
