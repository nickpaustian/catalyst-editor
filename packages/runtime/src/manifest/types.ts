import type { ResolutionSettings } from "@vitrine/catalyst"

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

/** A named stretch of the guided rail, from one control point to another. */
export type RailSegment = [string, string]

/**
 * A position along the guided path. Either an absolute path progress (0–1,
 * and beyond 1 while the footer scrolls) or a parameter `t` (0–1) inside a
 * named rail segment, which is how the intro sequence thresholds are expressed.
 */
export type ProgressPoint = number | { segment: RailSegment; t: number }

/** Open-ended on either side when `from` or `to` is omitted. */
export interface ProgressRange {
  from?: ProgressPoint
  to?: ProgressPoint
}

export interface SplatStreamingSettings {
  splatBudget?: number
  maxSlice?: number
  minSliceSplats?: number
  maxStaleness?: number
  frameUploadBudget?: number
  frustumExpansion?: number
  frustumSmear?: number
  frustumSmearScale?: number
  frustumSmearFrames?: number
  offScreenMaxSlice?: number
  sortFrustumCull?: boolean
  gpuBudgetHeadroom?: number
  shBands?: number
  minContribution?: number
  maxQualityDistance?: number
  falloffDistance?: number
  falloffStrength?: number
  floorLevel?: number
  coveragePasses?: number
  ndcRadiusFalloff?: number
  workerPoolSize?: number
}

export interface SplatTransform {
  position?: Vec3
  rotation?: Quat
  scale?: number
}

export interface SplatSource {
  /** Base URL of the `.vgs` folder (holds `manifest.bin.json` and per-cell slices). */
  source: string
  /** `.vgsp` partition files, loaded in this order before streaming starts. */
  partitions: string[]
  transform?: SplatTransform
  streaming?: SplatStreamingSettings
}

/** Node JSON files in the `parseJsonNodes` format, relative to the manifest. */
export interface SceneFiles {
  colliders?: string
  focalPoints?: string
  focalPointTriggers?: string
  pointsOfInterest?: string
}

export interface RailControlPoint {
  name: string
  point: Vec3
}

export interface SpeedSegment {
  segment: RailSegment
  speed: number
}

/** A dot on the progress bar: where it sits (remapped %) and where it jumps to. */
export interface ProgressMarker {
  percentage: number
  progress: number
}

/** Turns a focal point, or every trigger carrying a tag, on only inside the given ranges. */
export interface ActivationRule {
  focalPoint?: string
  triggerTag?: string
  activeWhen: ProgressRange[]
}

export interface GuidedCameraSettings {
  focalLength?: number
  rail: {
    offset?: Vec3
    controlPoints: RailControlPoint[]
  }
  /** Baked `camera-path.json` recorded in-app; when present it drives the camera instead of the rail. */
  bakedPath?: string
  scroll: {
    /** Path progress per unit of scroll force. */
    increment: number
    /** Multiplier on `increment` outside any speed segment. */
    speed: number
    speedSegments?: SpeedSegment[]
  }
  /** Path progress → displayed progress, piecewise linear. */
  progressRemap?: [number, number][]
  progressMarkers?: ProgressMarker[]
  /** Displayed progress (%) after which the markers are added to the bar. */
  progressMarkersRevealAt?: number
  activation?: ActivationRule[]
}

export interface FirstPersonSettings {
  start: Vec3
}

export interface CameraSettings {
  initial: "guided" | "firstPerson"
  guided?: GuidedCameraSettings
  firstPerson?: FirstPersonSettings
}

export interface HtmlContent {
  type: "html"
  src: string
}

export type ContentEntry = HtmlContent

export interface AssetSources {
  images?: Record<string, string>
  audio?: Record<string, string>
}

export interface LogoEntry {
  id: string
  src: string
  href?: string
  alt?: string
  class?: string
}

export interface PresentationIcons {
  settings?: string
  soundOn?: string
  soundOff?: string
  headphones?: string
  scrollArrow?: string
}

export interface LandingPresentation {
  logo?: string
  logoAlt?: string
  tagline?: string
  description?: string
  headphonesNote?: string
  scrollPrompt?: string
  /** The card scrolls away over the first `scrollOutAt` of this rail segment. */
  segment?: RailSegment
  scrollOutAt?: number
  offsetVh?: number
}

export interface HeaderPresentation {
  hideBelow?: ProgressPoint
  showAbove?: ProgressPoint
}

export interface HudPresentation {
  moveHint?: string
  /** The idle hint only shows past this point (so not during the intro). */
  moveHintAfter?: ProgressPoint
}

export interface FooterPresentation {
  title?: string
  copy?: string
  creditsTitle?: string
  credits?: string[]
  logo?: string
  logoAlt?: string
  restartLabel?: string
  /** The card slides up over this range. */
  reveal?: ProgressRange
  blur?: { range: ProgressRange; px: number }
  /** Path progress per scrollable pixel of footer copy. */
  scrollFeel?: number
}

export interface Presentation {
  icons?: PresentationIcons
  logos?: LogoEntry[]
  landing?: LandingPresentation
  header?: HeaderPresentation
  hud?: HudPresentation
  footer?: FooterPresentation
  /** Audio asset keys for the UI sounds. */
  sounds?: { click?: string; clack?: string }
  /** HTML for the pause menu, relative to the manifest. */
  menu?: string
}

export interface RenderingSettings {
  targetFps?: number
  resolution?: ResolutionSettings
}

export interface ExhibitionManifest {
  version: 1
  id: string
  title: string
  splat: SplatSource
  scene: SceneFiles
  camera: CameraSettings
  content: Record<string, ContentEntry>
  assets?: AssetSources
  presentation?: Presentation
  rendering?: RenderingSettings
}

/** A manifest whose relative paths have been resolved against its own URL. */
export interface LoadedManifest extends ExhibitionManifest {
  url: string
}
