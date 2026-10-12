import type { GaussianSplatData } from "../../../types"
import { unzipStoredEntries } from "./ZipReader"


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImagePixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

interface SogMeta {
  version: number
  count: number
  antialias?: boolean
  means: {
    mins: [number, number, number]
    maxs: [number, number, number]
    files: string[]
  }
  scales: {
    codebook: number[]
    files: string[]
  }
  quats: {
    files: string[]
  }
  sh0: {
    codebook: number[]
    files: string[]
  }
  shN?: {
    codebook: number[]
    count?: number
    bands?: number
    files: string[]
  }
}

// ---------------------------------------------------------------------------
// Image decoding
// ---------------------------------------------------------------------------

/**
 * Decode an image to raw RGBA pixel data without any color-space conversion
 * or premultiplied-alpha transforms.
 *
 * SOG images store raw data values (codebook indices 0-255, quaternion
 * component bytes, etc.) — not displayable colors. Any browser-side color
 * pipeline (gamma, YUV→RGB, premultiplied alpha) corrupts these values.
 *
 * Primary path: WebGL2 texture upload with UNPACK_COLORSPACE_CONVERSION_WEBGL
 * = NONE and UNPACK_PREMULTIPLY_ALPHA_WEBGL = false, followed by readPixels.
 * This is the only cross-browser reliable way to get raw bytes.
 *
 * Fallback: 2D canvas with colorSpaceConversion:'none'. Less reliable
 * (browsers may still premultiply during drawImage) but better than nothing.
 */
async function loadImagePixels(src: string | Uint8Array): Promise<ImagePixels> {
  let blob: Blob
  if (typeof src === "string") {
    const resp = await fetch(src)
    if (!resp.ok) throw new Error(`Failed to fetch image: ${src} (${resp.status})`)
    blob = await resp.blob()
  } else {
    blob = new Blob([src as unknown as ArrayBuffer], { type: "image/webp" })
  }

  // createImageBitmap with no color conversion or premultiplied alpha.
  // This is the input to both the WebGL and canvas paths.
  const bitmap = await createImageBitmap(blob, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  })
  const { width, height } = bitmap

  // --- WebGL path -----------------------------------------------------------
  // gl.UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE: no color-space transform on upload.
  // gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL = false: no premultiply on upload.
  // gl.readPixels: reads raw stored bytes — guaranteed identical across browsers.
  // Without UNPACK_FLIP_Y_WEBGL, texImage2D puts image row 0 at texture y=0
  // (GL bottom), which readPixels(y=0) also reads first → top-down order. ✓
  try {
    let glCanvas: HTMLCanvasElement | OffscreenCanvas
    if (typeof OffscreenCanvas !== "undefined") {
      glCanvas = new OffscreenCanvas(width, height)
    } else {
      glCanvas = document.createElement("canvas")
      glCanvas.width = width
      glCanvas.height = height
    }

    const gl = (glCanvas as OffscreenCanvas).getContext("webgl2") as WebGL2RenderingContext | null
    if (!gl) throw new Error("WebGL2 unavailable")

    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)

    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)

    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)

    const raw = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw)

    gl.deleteTexture(tex)
    gl.deleteFramebuffer(fb)
    bitmap.close()

    return { data: new Uint8ClampedArray(raw.buffer), width, height }
  } catch (e) {
    console.warn("[SOGParser] WebGL decode failed, falling back to canvas:", e)
  }

  // --- Canvas 2D fallback ---------------------------------------------------
  let canvas: HTMLCanvasElement | OffscreenCanvas
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(width, height)
  } else {
    canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  return { data: ctx.getImageData(0, 0, width, height).data, width, height }
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Inverse of sign(v)*log(|v|+1) — recovers original position from log-space. */
function unlog(n: number): number {
  return Math.sign(n) * (Math.exp(Math.abs(n)) - 1)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Reconstruct a unit quaternion from its 3-component SOG encoding.
 *
 * The largest component is dropped and reconstructed as the sqrt of the
 * remainder. The alpha byte encodes which component was dropped (mode 0-3).
 * Returns [qx, qy, qz, qw] normalized, positive-w hemisphere.
 */
function reconstructQuaternion(r: number, g: number, b: number, a: number): [number, number, number, number] {
  const comp = (c: number) => (c / 255 - 0.5) * (2.0 / Math.SQRT2)
  const A = comp(r)
  const B = comp(g)
  const C = comp(b)
  const mode = a - 252
  const t = A * A + B * B + C * C
  const D = Math.sqrt(Math.max(0, 1 - t))

  let qx: number, qy: number, qz: number, qw: number
  // Mode encodes which component was largest (dropped):
  //   0 = W dropped → R=X, G=Y, B=Z
  //   1 = X dropped → R=W, G=Y, B=Z
  //   2 = Y dropped → R=W, G=X, B=Z
  //   3 = Z dropped → R=W, G=X, B=Y
  // Remaining components are stored in WXYZ order (skipping the dropped one).
  switch (mode) {
    case 0: qx = A; qy = B; qz = C; qw = D; break
    case 1: qx = D; qy = B; qz = C; qw = A; break
    case 2: qx = B; qy = D; qz = C; qw = A; break
    case 3: qx = B; qy = C; qz = D; qw = A; break
    default: throw new Error(`Invalid SOG quaternion mode: ${mode} (expected 0-3, alpha=${a})`)
  }

  // Enforce positive-w hemisphere (equivalent quaternions, avoids sign flip artifacts)
  if (qw < 0) { qx = -qx; qy = -qy; qz = -qz; qw = -qw }

  // Normalize
  const len = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
  if (len > 1e-6) { qx /= len; qy /= len; qz /= len; qw /= len }

  return [qx, qy, qz, qw]
}

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

const SH_C0 = 0.28209479177387814

// SH bands 1+2: 3 + 5 = 8 coefficients per colour channel
const SH_COEFFS_PER_CHANNEL = 8

async function parseSogData(
  meta: SogMeta,
  resolver: (name: string) => Promise<ImagePixels>,
): Promise<GaussianSplatData> {
  const hasSHN = !!(meta.shN && meta.shN.bands && meta.shN.files.length >= 2)
  const shNCoeffsTotal = hasSHN ? ([0, 3, 8, 15][meta.shN!.bands!] ?? 0) : 0

  // Load all required images in parallel
  const baseImages = Promise.all([
    resolver(meta.means.files[0]),
    resolver(meta.means.files[1]),
    resolver(meta.quats.files[0]),
    resolver(meta.scales.files[0]),
    resolver(meta.sh0.files[0]),
  ])

  // Load shN images concurrently with base images when available
  const shNImages = hasSHN
    ? Promise.all(meta.shN!.files.map((f) => resolver(f)))
    : Promise.resolve(null)

  const [[meansL, meansU, quats, scalesImg, sh0Img], shNImgList] = await Promise.all([
    baseImages,
    shNImages,
  ])

  // Identify which shN file is labels and which is centroids
  let labelsImg: ImagePixels | null = null
  let centroidsImg: ImagePixels | null = null
  if (hasSHN && shNImgList) {
    const f0 = meta.shN!.files[0]
    const isF0Labels = /label/i.test(f0)
    labelsImg = isF0Labels ? shNImgList[0] : shNImgList[1]
    centroidsImg = isF0Labels ? shNImgList[1] : shNImgList[0]
  }

  const imgWidth = meansL.width
  const imgHeight = meansL.height
  const count = Math.min(meta.count, imgWidth * imgHeight)

  const sh0Codebook = meta.sh0.codebook
  const scaleCodebook = meta.scales.codebook

  const positions = new Float32Array(count * 3)
  const covariances = new Float32Array(count * 6)
  const colors = new Uint8Array(count * 4)
  // Allocate 45 floats per splat (15 per channel) to match PLY layout; SOG only
  // fills 8 per channel (bands 1+2), the rest stay zero.
  const shCoeffs = hasSHN ? new Float32Array(count * 45) : null
  const shNCodebook = hasSHN ? meta.shN!.codebook : null

  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity

  for (let i = 0; i < count; i++) {
    const px = i % imgWidth
    const py = (i / imgWidth) | 0
    const idx = (px + py * imgWidth) * 4

    // ---- Position: 16-bit quantized → log-space lerp → unlog ---------------
    const qx16 = (meansU.data[idx + 0] << 8) | meansL.data[idx + 0]
    const qy16 = (meansU.data[idx + 1] << 8) | meansL.data[idx + 1]
    const qz16 = (meansU.data[idx + 2] << 8) | meansL.data[idx + 2]
    const x = unlog(lerp(meta.means.mins[0], meta.means.maxs[0], qx16 / 65535))
    const y = unlog(lerp(meta.means.mins[1], meta.means.maxs[1], qy16 / 65535))
    const z = unlog(lerp(meta.means.mins[2], meta.means.maxs[2], qz16 / 65535))

    positions[i * 3]     = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z

    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z

    // ---- Scale: codebook lookup → exp (codebook stores log-scale values) ---
    const sx = Math.exp(scaleCodebook[scalesImg.data[idx + 0]])
    const sy = Math.exp(scaleCodebook[scalesImg.data[idx + 1]])
    const sz = Math.exp(scaleCodebook[scalesImg.data[idx + 2]])
    // ---- Rotation: 3-component + mode byte → unit quaternion ----------------
    const [qx, qy, qz, qw] = reconstructQuaternion(
      quats.data[idx + 0],
      quats.data[idx + 1],
      quats.data[idx + 2],
      quats.data[idx + 3],
    )

    // ---- 3D covariance: Σ = M·Mᵀ, M = R·diag(sx,sy,sz) --------------------
    const m00 = (1 - 2 * (qy * qy + qz * qz)) * sx
    const m10 = (2 * (qx * qy + qw * qz)) * sx
    const m20 = (2 * (qx * qz - qw * qy)) * sx

    const m01 = (2 * (qx * qy - qw * qz)) * sy
    const m11 = (1 - 2 * (qx * qx + qz * qz)) * sy
    const m21 = (2 * (qy * qz + qw * qx)) * sy

    const m02 = (2 * (qx * qz + qw * qy)) * sz
    const m12 = (2 * (qy * qz - qw * qx)) * sz
    const m22 = (1 - 2 * (qx * qx + qy * qy)) * sz

    const ci = i * 6
    covariances[ci]     = m00 * m00 + m01 * m01 + m02 * m02 // M11
    covariances[ci + 1] = m00 * m10 + m01 * m11 + m02 * m12 // M12
    covariances[ci + 2] = m00 * m20 + m01 * m21 + m02 * m22 // M13
    covariances[ci + 3] = m10 * m10 + m11 * m11 + m12 * m12 // M22
    covariances[ci + 4] = m10 * m20 + m11 * m21 + m12 * m22 // M23
    covariances[ci + 5] = m20 * m20 + m21 * m21 + m22 * m22 // M33
    // ---- Colour: sh0 codebook → linear RGB → uint8 -------------------------
    const r = clamp(Math.round((0.5 + sh0Codebook[sh0Img.data[idx + 0]] * SH_C0) * 255), 0, 255)
    const g = clamp(Math.round((0.5 + sh0Codebook[sh0Img.data[idx + 1]] * SH_C0) * 255), 0, 255)
    const b = clamp(Math.round((0.5 + sh0Codebook[sh0Img.data[idx + 2]] * SH_C0) * 255), 0, 255)

    // ---- Opacity: already sigmoid-mapped in the image alpha channel ---------
    const alpha = sh0Img.data[idx + 3]

    const ki = i * 4
    colors[ki]     = r
    colors[ki + 1] = g
    colors[ki + 2] = b
    colors[ki + 3] = alpha

    // ---- Higher-order SH (bands 1+2, 8 coefficients per channel) -----------
    if (shCoeffs && shNCodebook && labelsImg && centroidsImg) {
      const label = labelsImg.data[idx] | (labelsImg.data[idx + 1] << 8)
      const labelCol = label % 64
      const labelRow = (label / 64) | 0
      const cW = centroidsImg.width
      const si = i * 45  // 15-per-channel stride; band 3 slots stay zero

      for (let j = 0; j < SH_COEFFS_PER_CHANNEL; j++) {
        const u = labelCol * shNCoeffsTotal + j
        const cidx = (labelRow * cW + u) * 4
        shCoeffs[si + j]       = shNCodebook[centroidsImg.data[cidx]]     ?? 0  // R[j]
        shCoeffs[si + 15 + j]  = shNCodebook[centroidsImg.data[cidx + 1]] ?? 0  // G[j]
        shCoeffs[si + 30 + j]  = shNCodebook[centroidsImg.data[cidx + 2]] ?? 0  // B[j]
      }
    }
  }

  return {
    count,
    positions,
    covariances,
    colors,
    ...(shCoeffs ? { shCoeffs, shDegree: 2 as const } : {}),
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Parse a bundled .sog file (uncompressed ZIP archive containing meta.json
 * and the associated WebP image files).
 */
export async function parseSOGBundle(buffer: ArrayBuffer): Promise<GaussianSplatData> {
  const files = unzipStoredEntries(buffer)

  const metaBytes = files.get("meta.json")
  if (!metaBytes) throw new Error("SOG bundle missing meta.json")
  const meta: SogMeta = JSON.parse(new TextDecoder().decode(metaBytes))

  const resolver = async (name: string): Promise<ImagePixels> => {
    const bytes = files.get(name)
    if (!bytes) throw new Error(`SOG bundle missing image: ${name}`)
    return loadImagePixels(bytes)
  }

  return parseSogData(meta, resolver)
}

/**
 * Parse a SOG scene from a directory URL containing meta.json and WebP images.
 * The base URL should end with a trailing slash.
 */
export async function parseSOGFromDirectory(baseURL: string): Promise<GaussianSplatData> {
  const metaResp = await fetch(`${baseURL}meta.json`)
  if (!metaResp.ok) throw new Error(`Failed to fetch SOG meta.json from ${baseURL}`)
  const meta: SogMeta = await metaResp.json()

  const resolver = async (name: string): Promise<ImagePixels> => {
    return loadImagePixels(`${baseURL}${name}`)
  }

  return parseSogData(meta, resolver)
}
