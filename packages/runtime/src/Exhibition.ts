import ManagerRegistry from "./managers/ManagerRegistry"
import { loadManifest, type LoadedManifest } from "./manifest"
import { debug } from "./utils"

export interface ExhibitionHandle {
  manifest: LoadedManifest
  managers: ManagerRegistry
}

/**
 * Loads a manifest and stands the exhibition up in `#app`, the way Beruk's
 * `App` did with its hard-coded scene. One exhibition per page for now.
 */
export const runExhibition = async (
  manifestUrl: string
): Promise<ExhibitionHandle> => {
  const manifest = await loadManifest(manifestUrl)
  debug(`Loaded manifest for ${manifest.id}`, "init")

  document.title = manifest.title

  const managers = ManagerRegistry.create(manifest)

  managers.scene.setup()
  managers.scene.loadAssets()

  if (__DEBUG__) {
    import("./debug/setupBenchmark").then(({ default: setupBenchmark }) =>
      setupBenchmark(managers)
    )
  }

  return { manifest, managers }
}
