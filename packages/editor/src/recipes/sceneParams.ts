import type { Catalyst, Node } from "@nickpaustian/catalyst"
import { OrbitCamera } from "@nickpaustian/catalyst/prefabs"
import type { ToneMapping } from "@nickpaustian/obelisk"

const DEG = Math.PI / 180
const TONE_MAPPINGS: ToneMapping[] = ["none", "neutral", "aces"]

const firstOrbit = (root: Node): OrbitCamera | null => {
  let orbit: OrbitCamera | null = null
  root.walk((node) => {
    if (!orbit && node instanceof OrbitCamera) orbit = node
  })
  return orbit
}

/** `yaw,pitch,distance,x,y,z`: degrees, then the orbit's own units and space. */
const formatCamera = (orbit: OrbitCamera): string => {
  const { yaw, pitch, distance, target } = orbit.goalPose
  return [yaw / DEG, pitch / DEG, distance, target.x, target.y, target.z].map((v) => Number(v.toFixed(4))).join(",")
}

const parseCamera = (text: string | null): number[] | null => {
  const values = text?.split(",").map(Number) ?? []
  return values.length === 6 && values.every(Number.isFinite) ? values : null
}

/**
 * What a published scene's address can say: `?camera=` opens the orbit on
 * a pose, `?exposure=` and `?tonemap=` change the look, and `?embed` sets
 * the project mode `embed` (with `embed-<value>` for `?embed=bar` and the
 * like), which a project's stylesheets read to hide what an embedded view
 * shouldn't show. The URL wins over the scene.
 */
export const applySceneParams = (engine: Catalyst, root: Node, params: URLSearchParams): void => {
  const camera = parseCamera(params.get("camera"))
  const orbit = firstOrbit(root)
  if (camera && orbit) orbit.setPose({ yaw: camera[0] * DEG, pitch: camera[1] * DEG, distance: camera[2], target: { x: camera[3], y: camera[4], z: camera[5] } }, true)
  const exposure = Number(params.get("exposure"))
  if (params.has("exposure") && Number.isFinite(exposure)) engine.exposure = exposure
  const tonemap = params.get("tonemap") as ToneMapping | null
  if (tonemap && TONE_MAPPINGS.includes(tonemap)) engine.toneMapping = tonemap
  if (params.has("embed")) {
    engine.modes.set("embed", true)
    const variant = params.get("embed")
    if (variant && variant !== "none") engine.modes.set(`embed-${variant}`, true)
  }
}

/** Keep `?camera=` in the address as the view comes to rest after it was taken, so a copied link opens on what it shows. Gives back the way to stop. */
export const linkCamera = (engine: Catalyst, root: Node): (() => void) => {
  const orbit = firstOrbit(root)
  if (!orbit) return () => undefined
  let linked = new URLSearchParams(location.search).get("camera") ?? ""
  return engine.signals.onUpdate.subscribe(() => {
    if (!orbit.touched || !orbit.settled) return
    const pose = formatCamera(orbit)
    if (pose === linked) return
    linked = pose
    const url = new URL(location.href)
    url.searchParams.set("camera", pose)
    history.replaceState(history.state, "", url)
  })
}
