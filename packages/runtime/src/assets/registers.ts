import {
  Asset,
  AudioAsset,
  ImageAsset,
  JsonAsset,
  ResourceType,
  SplatAsset,
  TextAsset,
  type ResourceLoadConfig,
} from "@vitrine/assets"
import type { LoadedManifest } from "../manifest"
import { assets } from "./registry"

export interface AudioEntry {
  asset: AudioAsset
  group?: string
  decode?: "keep" | "on-demand"
}

export interface ExhibitionAssets {
  /** Everything the exhibition registered; release this to drop it all. */
  root: Asset
  /** What the loading screen waits for: scene files, camera path, splat partitions, audio, images. */
  core: Asset
  /** Modal HTML, fetched on demand. */
  content: Asset
  scene: {
    /** The whole hierarchy, when the manifest names one scene file. */
    tree?: JsonAsset
    colliders?: JsonAsset
    focalPoints?: JsonAsset
    focalPointTriggers?: JsonAsset
    pointsOfInterest?: JsonAsset
  }
  bakedPath?: JsonAsset
  partitions: SplatAsset[]
  /** Manifest audio key → asset and playback hints, so tracks keep their manifest names. */
  audio: Map<string, AudioEntry>
  images: Map<string, ImageAsset>
  contentById: Map<string, TextAsset>
  menu: TextAsset
}

export const rootKey = (id: string) => `exhibition:${id}`

/**
 * Registers every file the manifest names as a stub keyed by its URL, so two
 * exhibitions sharing a file share the stub and the cache entry. Existing
 * stubs are kept as they are (they may already be ready).
 */
export const registerExhibition = (manifest: LoadedManifest): ExhibitionAssets => {
  const single = <T extends Asset>(
    make: (opts: { key: string; resources: string[] }) => T,
    type: ResourceType,
    url: string
  ): T => {
    const resource: ResourceLoadConfig = { key: url, type, url }
    if (!assets.resources.has(url)) assets.resources.register(resource)
    return assets.registerOrGet(make({ key: url, resources: [url] }))
  }
  const json = (url: string) => single((o) => new JsonAsset(o), ResourceType.JSON, url)
  const text = (url: string) => single((o) => new TextAsset(o), ResourceType.TEXT, url)

  const scene =
    typeof manifest.scene === "string"
      ? { tree: json(manifest.scene) }
      : {
          colliders: manifest.scene.colliders ? json(manifest.scene.colliders) : undefined,
          focalPoints: manifest.scene.focalPoints ? json(manifest.scene.focalPoints) : undefined,
          focalPointTriggers: manifest.scene.focalPointTriggers
            ? json(manifest.scene.focalPointTriggers)
            : undefined,
          pointsOfInterest: manifest.scene.pointsOfInterest
            ? json(manifest.scene.pointsOfInterest)
            : undefined,
        }
  const bakedPath = manifest.camera.guided?.bakedPath
    ? json(manifest.camera.guided.bakedPath)
    : undefined

  const partitions = manifest.splat.partitions.map((url) =>
    single((o) => new SplatAsset(o), ResourceType.SPLAT, url)
  )

  const audio = new Map<string, AudioEntry>(
    Object.entries(manifest.assets?.audio ?? {}).map(([name, source]) => {
      const { url, ...hints } = typeof source === "string" ? { url: source } : source
      return [
        name,
        { ...hints, asset: single((o) => new AudioAsset(o), ResourceType.AUDIO, url) },
      ]
    })
  )
  const images = new Map(
    Object.entries(manifest.assets?.images ?? {}).map(([name, url]) => [
      name,
      single((o) => new ImageAsset(o), ResourceType.IMAGE, url),
    ])
  )

  const contentById = new Map(
    Object.entries(manifest.content).map(([id, entry]) => [id, text(entry.src)])
  )
  const menuUrl = manifest.presentation?.menu
  if (!menuUrl) {
    throw new Error("Manifest has no presentation.menu for the pause screen")
  }
  const menu = text(menuUrl)

  const keys = (list: (Asset | undefined)[]) =>
    list.filter((a): a is Asset => !!a).map((a) => a.key)

  const id = manifest.id
  const core = assets.registerOrGet(
    new Asset({
      key: `${rootKey(id)}/core`,
      children: {
        scene: keys(Object.values(scene)),
        path: keys([bakedPath]),
        splat: keys(partitions),
        audio: keys([...audio.values()].map((entry) => entry.asset)),
        images: keys([...images.values()]),
      },
    })
  )
  const content = assets.registerOrGet(
    new Asset({
      key: `${rootKey(id)}/content`,
      children: keys([menu, ...contentById.values()]),
    })
  )
  const root = assets.registerOrGet(
    new Asset({ key: rootKey(id), children: [core.key, content.key] })
  )

  return {
    root,
    core,
    content,
    scene,
    bakedPath,
    partitions,
    audio,
    images,
    contentById,
    menu,
  }
}
