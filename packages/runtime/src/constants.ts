import type { ResolutionSettings } from "@vitrine/catalyst"

export const namespace = "VITRINE"
export const storageNamespace = `${namespace}__`
export const buildVer = "0.1.0"

export const uiTimeoutTime = 1000
export const scrollMessageDisplayLimit = 9999
export const mouseInteractThreshold = 100

export const defaultTargetFps = 30

export const defaultRenderResolution: ResolutionSettings = {
  mode: "dynamic",
  maxPixelRatio: 2,
  minPixelRatio: 1,
  step: 0.25,
  settleMs: 250,
}

export const Easing = {
  linear: (t: number): number => t,

  easeInQuad: (t: number): number => t * t,
  easeOutQuad: (t: number): number => t * (2 - t),
  easeInOutQuad: (t: number): number =>
    t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  easeInCubic: (t: number): number => t * t * t,
  easeOutCubic: (t: number): number => --t * t * t + 1,
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  easeInSine: (t: number): number => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t: number): number => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2,

  smoothstep: (t: number): number => {
    t = Math.max(0, Math.min(1, t))
    return t * t * (3 - 2 * t)
  },

  smootherstep: (t: number): number => {
    t = Math.max(0, Math.min(1, t))
    return t * t * t * (t * (t * 6 - 15) + 10)
  },
}
