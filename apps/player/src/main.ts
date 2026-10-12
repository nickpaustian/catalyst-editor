import "@vitrine/runtime/styles.scss"
import { runExhibition } from "@vitrine/runtime"

interface CatalogueEntry {
  id: string
  title: string
  manifest: string
}

interface Catalogue {
  exhibitions: CatalogueEntry[]
}

const CATALOGUE_URL = "exhibitions/index.json"

const pickExhibition = async (): Promise<CatalogueEntry> => {
  const response = await fetch(CATALOGUE_URL)
  if (!response.ok) {
    throw new Error(`Failed to load catalogue (${response.status})`)
  }
  const catalogue = (await response.json()) as Catalogue

  const requested = new URLSearchParams(window.location.search).get(
    "exhibition"
  )
  const entry = requested
    ? catalogue.exhibitions.find((e) => e.id === requested)
    : catalogue.exhibitions[0]

  if (!entry) {
    throw new Error(`No exhibition "${requested ?? ""}" in the catalogue`)
  }
  return entry
}

document.addEventListener("DOMContentLoaded", async () => {
  const entry = await pickExhibition()
  const manifestUrl = new URL(entry.manifest, new URL(CATALOGUE_URL, window.location.href)).href
  await runExhibition(manifestUrl)
})
