import { JsonAsset, ResourceType } from "@vitrine/assets"
import { assets } from "../assets/registry"
import type { AudioSource, ExhibitionManifest, LoadedManifest } from "./types"

/** Turns a path as written in the manifest into a URL the loader can fetch. */
export type PathResolver = (path: string) => string

const resolveRecord = (
  r: (path: string | undefined) => string | undefined,
  record: Record<string, string> | undefined
): Record<string, string> | undefined => {
  if (!record) return undefined
  return Object.fromEntries(
    Object.entries(record).map(([key, path]) => [key, r(path)!])
  )
}

const resolveAudio = (
  r: (path: string | undefined) => string | undefined,
  record: Record<string, AudioSource> | undefined
): Record<string, AudioSource> | undefined => {
  if (!record) return undefined
  return Object.fromEntries(
    Object.entries(record).map(([key, source]) => [
      key,
      typeof source === "string"
        ? r(source)!
        : { ...source, url: r(source.url)! },
    ])
  )
}

/**
 * Rewrites every path in the manifest through `resolver`. `url` identifies the
 * loaded manifest (its own URL, or anything unique for a folder-backed one).
 */
export const resolveManifestPaths = (
  manifest: ExhibitionManifest,
  resolver: PathResolver,
  url: string
): LoadedManifest => {
  const r = (path: string | undefined) =>
    path === undefined ? undefined : resolver(path)
  const presentation = manifest.presentation

  return {
    ...manifest,
    url,
    splat: {
      ...manifest.splat,
      source: r(manifest.splat.source)!,
      partitions: manifest.splat.partitions.map((p) => r(p)!),
    },
    scene:
      typeof manifest.scene === "string"
        ? r(manifest.scene)!
        : {
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
      images: resolveRecord(r, manifest.assets.images),
      audio: resolveAudio(r, manifest.assets.audio),
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

/** Rewrites every path in the manifest to an absolute URL, relative to `baseUrl`. */
export const resolveManifestUrls = (
  manifest: ExhibitionManifest,
  baseUrl: string
): LoadedManifest =>
  resolveManifestPaths(manifest, (path) => new URL(path, baseUrl).href, baseUrl)

/** Absolute URLs pass through a resolver unchanged, so folders can mix local files and CDN assets. */
export const isAbsoluteUrl = (path: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(path)

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
