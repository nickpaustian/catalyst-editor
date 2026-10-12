import type { LoadedManifest } from "../manifest"
import { Asset, ImageAsset, SplatAsset } from "../managers/AssetManager"
import AudioAsset from "../managers/AssetManager/assets/AudioAsset"
import type { ResourceLoadConfig } from "../managers/AssetManager"
import { ResourceType } from "../managers/AssetManager/types"

export const SCENE_ASSET_KEY = "scene"

export const partitionAssetKey = (manifest: LoadedManifest, index: number) =>
  `${manifest.id}-vgsp${index}`

export interface ExhibitionRegisters {
  resources: ResourceLoadConfig[]
  assets: Asset[]
}

/** Builds the resource and asset registers Beruk kept by hand in `src/data/registers`. */
export const buildRegisters = (
  manifest: LoadedManifest
): ExhibitionRegisters => {
  const resources: ResourceLoadConfig[] = []
  const assets: Asset[] = []
  const images: string[] = []
  const audio: string[] = []
  const splat: string[] = []

  Object.entries(manifest.assets?.images ?? {}).forEach(([key, url]) => {
    resources.push({ key: `img__${key}`, type: ResourceType.IMAGE, url })
    assets.push(new ImageAsset({ key, resources: [`img__${key}`] }))
    images.push(key)
  })

  Object.entries(manifest.assets?.audio ?? {}).forEach(([key, url]) => {
    resources.push({ key: `audio__${key}`, type: ResourceType.AUDIO, url })
    assets.push(new AudioAsset({ key, resources: [`audio__${key}`] }))
    audio.push(key)
  })

  manifest.splat.partitions.forEach((url, index) => {
    const key = partitionAssetKey(manifest, index)
    resources.push({ key, type: ResourceType.SPLAT, url })
    assets.push(new SplatAsset({ key, resources: [key] }))
    splat.push(key)
  })

  assets.push(
    new Asset({
      key: SCENE_ASSET_KEY,
      children: { images, splat, audio },
    })
  )

  return { resources, assets }
}
