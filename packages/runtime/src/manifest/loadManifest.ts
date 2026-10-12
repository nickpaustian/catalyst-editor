import { JsonAsset, ResourceType } from "@vitrine/assets"
import { assets } from "../assets/registry"
import type { AudioSource, ExhibitionManifest, LoadedManifest } from "./types"

const resolve = (base: string, path: string | undefined): string | undefined =>
  path === undefined ? undefined : new URL(path, base).href

const resolveRecord = (
  base: string,
  record: Record<string, string> | undefined
): Record<string, string> | undefined => {
  if (!record) return undefined
  return Object.fromEntries(
    Object.entries(record).map(([key, path]) => [key, resolve(base, path)!])
  )
}

const resolveAudio = (
  base: string,
  record: Record<string, AudioSource> | undefined
): Record<string, AudioSource> | undefined => {
  if (!record) return undefined
  return Object.fromEntries(
    Object.entries(record).map(([key, source]) => [
      key,
      typeof source === "string"
        ? resolve(base, source)!
        : { ...source, url: resolve(base, source.url)! },
    ])
  )
}

/** Rewrites every path in the manifest to an absolute URL, relative to `baseUrl`. */
export const resolveManifestUrls = (
  manifest: ExhibitionManifest,
  baseUrl: string
): LoadedManifest => {
  const r = (path: string | undefined) => resolve(baseUrl, path)
  const presentation = manifest.presentation

  return {
    ...manifest,
    url: baseUrl,
    splat: {
      ...manifest.splat,
      source: r(manifest.splat.source)!,
      partitions: manifest.splat.partitions.map((p) => r(p)!),
    },
    scene: {
      colliders: r(manifest.scene.colliders),
      focalPoints: r(manifest.scene.focalPoints),
      focalPointTriggers: r(manifest.scene.focalPointTriggers),
      pointsOfInterest: r(manifest.scene.pointsOfInterest),
    },
    camera: {
      ...manifest.camera,
      guided: manifest.camera.guided && {
        ...manifest.camera.guided,
        bakedPath: r(manifest.camera.guided.bakedPath),
      },
    },
    content: Object.fromEntries(
      Object.entries(manifest.content).map(([id, entry]) => [
        id,
        { ...entry, src: r(entry.src)! },
      ])
    ),
    assets: manifest.assets && {
      images: resolveRecord(baseUrl, manifest.assets.images),
      audio: resolveAudio(baseUrl, manifest.assets.audio),
    },
    presentation: presentation && {
      ...presentation,
      menu: r(presentation.menu),
      icons: presentation.icons && {
        settings: r(presentation.icons.settings),
        soundOn: r(presentation.icons.soundOn),
        soundOff: r(presentation.icons.soundOff),
        headphones: r(presentation.icons.headphones),
        scrollArrow: r(presentation.icons.scrollArrow),
      },
      logos: presentation.logos?.map((logo) => ({
        ...logo,
        src: r(logo.src)!,
      })),
      landing: presentation.landing && {
        ...presentation.landing,
        logo: r(presentation.landing.logo),
      },
      footer: presentation.footer && {
        ...presentation.footer,
        logo: r(presentation.footer.logo),
      },
    },
  }
}

export const loadManifest = async (url: string): Promise<LoadedManifest> => {
  const absolute = new URL(url, window.location.href).href
  if (!assets.resources.has(absolute)) {
    assets.resources.register({ key: absolute, type: ResourceType.JSON, url: absolute })
  }
  const asset = assets.registerOrGet(
    new JsonAsset<ExhibitionManifest>({ key: absolute, resources: [absolute] })
  )
  await asset.ensure()
  const manifest = asset.json
  if (manifest.version !== 1) {
    throw new Error(`Unsupported manifest version ${manifest.version}`)
  }
  return resolveManifestUrls(manifest, absolute)
}
