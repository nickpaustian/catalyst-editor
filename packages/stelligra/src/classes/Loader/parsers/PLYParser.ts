import type { PointAttribute, PointCloud } from "../../../types"
import type { GaussianSplatData } from "../../../types"

// ---------------------------------------------------------------------------
// Shared header types
// ---------------------------------------------------------------------------

type PLYFormat = "ascii" | "binary_little_endian" | "binary_big_endian"

interface PLYProperty {
  name: string
  type: "float" | "double" | "int" | "uint" | "char" | "uchar"
}

interface PLYHeader {
  format: PLYFormat
  vertexCount: number
  properties: PLYProperty[]
}

interface FieldInfo {
  offset: number
  type: PLYProperty["type"]
}

// ---------------------------------------------------------------------------
// Header parsing helpers (shared between both parse paths)
// ---------------------------------------------------------------------------

function findHeaderEnd(view: Uint8Array): number {
  const needle = new TextEncoder().encode("end_header\n")
  for (let i = 0; i < view.length - needle.length; i++) {
    if (view.subarray(i, i + needle.length).every((v, j) => v === needle[j])) {
      return i + needle.length
    }
  }
  throw new Error("Invalid PLY file: no end_header marker found")
}

function getPropertySize(type: PLYProperty["type"]): number {
  switch (type) {
    case "float":
    case "int":
    case "uint":
      return 4
    case "double":
      return 8
    case "char":
    case "uchar":
      return 1
    default:
      throw new Error(`Unknown PLY property type: ${type}`)
  }
}

function parseHeader(view: Uint8Array): PLYHeader {
  const headerEnd = findHeaderEnd(view)
  const headerText = new TextDecoder().decode(view.slice(0, headerEnd))
  const lines = headerText.split("\n").filter((line) => line.trim())

  let vertexCount = 0
  const properties: PLYProperty[] = []

  for (const line of lines) {
    const vertexMatch = line.match(/element\s+vertex\s+(\d+)/i)
    if (vertexMatch) {
      vertexCount = parseInt(vertexMatch[1])
    }
    const propMatch = line.match(/property\s+(\w+)\s+(\w+)/i)
    if (propMatch) {
      properties.push({
        type: propMatch[1] as PLYProperty["type"],
        name: propMatch[2],
      })
    }
  }

  return {
    format:
      (headerText.match(/format\s+(\S+)/i)?.[1] as PLYFormat) ||
      "binary_little_endian",
    vertexCount,
    properties,
  }
}

function buildFieldMap(properties: PLYProperty[]): Map<string, FieldInfo> {
  const map = new Map<string, FieldInfo>()
  let offset = 0
  for (const prop of properties) {
    map.set(prop.name, { offset, type: prop.type })
    offset += getPropertySize(prop.type)
  }
  return map
}

function calculateStride(properties: PLYProperty[]): number {
  return properties.reduce((sum, p) => sum + getPropertySize(p.type), 0)
}

function readField(
  view: DataView,
  byteOffset: number,
  type: PLYProperty["type"],
  littleEndian: boolean,
): number {
  switch (type) {
    case "float":
      return view.getFloat32(byteOffset, littleEndian)
    case "double":
      return view.getFloat64(byteOffset, littleEndian)
    case "int":
      return view.getInt32(byteOffset, littleEndian)
    case "uint":
      return view.getUint32(byteOffset, littleEndian)
    case "char":
      return view.getInt8(byteOffset)
    case "uchar":
      return view.getUint8(byteOffset)
    default:
      throw new Error(`Unknown PLY property type: ${type}`)
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

// ---------------------------------------------------------------------------
// Point cloud parser (original path, unchanged behaviour)
// ---------------------------------------------------------------------------

function parsePLYBinaryPointCloud(
  data: ArrayBuffer,
  littleEndian: boolean,
): PointCloud {
  const view = new Uint8Array(data)
  const header = parseHeader(view)
  const headerEnd = findHeaderEnd(view)
  const splatData = new DataView(data, headerEnd)

  const stride = calculateStride(header.properties)
  const count = header.vertexCount
  const fieldMap = buildFieldMap(header.properties)

  const xField = fieldMap.get("x")
  const yField = fieldMap.get("y")
  const zField = fieldMap.get("z")

  if (!xField || !yField || !zField) {
    throw new Error("PLY file missing x, y, or z properties")
  }

  const positions = new Float32Array(count * 3)
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity

  for (let i = 0; i < count; i++) {
    const base = i * stride
    const x = readField(splatData, base + xField.offset, xField.type, littleEndian)
    const y = readField(splatData, base + yField.offset, yField.type, littleEndian)
    const z = readField(splatData, base + zField.offset, zField.type, littleEndian)

    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z

    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z
  }

  const attributes: PointAttribute[] = [
    { name: "position", data: positions, componentSize: 3 },
  ]

  return {
    points: attributes,
    metadata: {
      pointCount: count,
      bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
      sourceFormat: "ply",
      loadedAt: Date.now(),
    },
  }
}

export function parsePLYAsPointCloud(data: ArrayBuffer): PointCloud {
  const view = new Uint8Array(data)
  const header = parseHeader(view)

  if (header.format === "ascii") {
    throw new Error("ASCII PLY parsing not yet implemented")
  }

  return parsePLYBinaryPointCloud(data, header.format === "binary_little_endian")
}

// ---------------------------------------------------------------------------
// Gaussian splat parser
// ---------------------------------------------------------------------------

/**
 * SH_C0 = 1 / (2 * sqrt(π))
 * Converts a zeroth-order SH coefficient to a linear colour component:
 *   colour = 0.5 + SH_C0 * f_dc
 */
const SH_C0 = 0.28209479177387814

export function parsePLYAsGaussianSplat(data: ArrayBuffer): GaussianSplatData {
  const view = new Uint8Array(data)
  const header = parseHeader(view)

  if (header.format === "ascii") {
    throw new Error("ASCII PLY Gaussian splat parsing not yet implemented")
  }

  const littleEndian = header.format === "binary_little_endian"
  const headerEnd = findHeaderEnd(view)
  const splatData = new DataView(data, headerEnd)

  const stride = calculateStride(header.properties)
  const count = header.vertexCount
  const fm = buildFieldMap(header.properties)

  // Position (required)
  const xField = fm.get("x")
  const yField = fm.get("y")
  const zField = fm.get("z")
  if (!xField || !yField || !zField) {
    throw new Error("PLY file missing position properties for Gaussian splat parsing")
  }

  // Scale (log-space in file, linear after exp())
  const s0Field = fm.get("scale_0")
  const s1Field = fm.get("scale_1")
  const s2Field = fm.get("scale_2")

  // Rotation quaternion (w, x, y, z in the file — INRIA convention)
  const r0Field = fm.get("rot_0") // w
  const r1Field = fm.get("rot_1") // x
  const r2Field = fm.get("rot_2") // y
  const r3Field = fm.get("rot_3") // z

  // Colour — SH DC term preferred, vertex colours as fallback
  const fdc0Field = fm.get("f_dc_0")
  const fdc1Field = fm.get("f_dc_1")
  const fdc2Field = fm.get("f_dc_2")
  const redField = fm.get("red")
  const greenField = fm.get("green")
  const blueField = fm.get("blue")

  // Opacity (logit-space in file, sigmoid after conversion)
  const opacityField = fm.get("opacity")

  // Higher-order SH coefficients (f_rest_N): 15 per channel for degree 3,
  // 8 per channel for degree 2, 3 per channel for degree 1.
  // Layout: all R coefficients first, then G, then B (per-channel contiguous).
  const frestFields: (FieldInfo | undefined)[] = []
  for (let i = 0; fm.get(`f_rest_${i}`); i++) frestFields.push(fm.get(`f_rest_${i}`))
  const frestTotal = frestFields.length
  const frestPerChannel = (frestTotal / 3) | 0             // 15, 8, or 3
  const shPerChannel = Math.min(frestPerChannel, 15)        // up to bands 1+2+3
  const hasSH = shPerChannel >= 3                           // at least band 1

  const hasSHColor = fdc0Field && fdc1Field && fdc2Field
  const hasVertexColor = redField && greenField && blueField

  const positions = new Float32Array(count * 3)
  const covariances = new Float32Array(count * 6)
  const colors = new Uint8Array(count * 4)
  // 24 floats per splat: [R0..R7, G0..G7, B0..B7] — zero-padded if degree < 2
  // Always allocate 45 floats per splat (15 per channel); unused tail is zero
  const shCoeffs = hasSH ? new Float32Array(count * 45) : null
  const shDegree: 1 | 2 | 3 = shPerChannel >= 8 ? (shPerChannel >= 15 ? 3 : 2) : 1

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity

  for (let i = 0; i < count; i++) {
    const base = i * stride

    // ---- Position ----------------------------------------------------------
    const x = readField(splatData, base + xField.offset, xField.type, littleEndian)
    const y = readField(splatData, base + yField.offset, yField.type, littleEndian)
    const z = readField(splatData, base + zField.offset, zField.type, littleEndian)

    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z

    if (x < minX) minX = x
    if (y < minY) minY = y
    if (z < minZ) minZ = z
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
    if (z > maxZ) maxZ = z

    // ---- Scale (exp to convert from log-space) ------------------------------
    const sx = s0Field ? Math.exp(readField(splatData, base + s0Field.offset, s0Field.type, littleEndian)) : 0.01
    const sy = s1Field ? Math.exp(readField(splatData, base + s1Field.offset, s1Field.type, littleEndian)) : 0.01
    const sz = s2Field ? Math.exp(readField(splatData, base + s2Field.offset, s2Field.type, littleEndian)) : 0.01
    // ---- Rotation (normalize quaternion, INRIA stores as w,x,y,z) ----------
    let qw = r0Field ? readField(splatData, base + r0Field.offset, r0Field.type, littleEndian) : 1.0
    let qx = r1Field ? readField(splatData, base + r1Field.offset, r1Field.type, littleEndian) : 0.0
    let qy = r2Field ? readField(splatData, base + r2Field.offset, r2Field.type, littleEndian) : 0.0
    let qz = r3Field ? readField(splatData, base + r3Field.offset, r3Field.type, littleEndian) : 0.0

    const qLen = Math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz)
    if (qLen > 1e-6) {
      qw /= qLen
      qx /= qLen
      qy /= qLen
      qz /= qLen
    }

    // ---- 3D covariance: Σ = M·Mᵀ where M = R·diag(sx,sy,sz) ---------------
    // Rotation matrix columns, each scaled by the corresponding scale value
    const m00 = (1 - 2 * (qy * qy + qz * qz)) * sx
    const m10 = (2 * (qx * qy + qw * qz)) * sx
    const m20 = (2 * (qx * qz - qw * qy)) * sx

    const m01 = (2 * (qx * qy - qw * qz)) * sy
    const m11 = (1 - 2 * (qx * qx + qz * qz)) * sy
    const m21 = (2 * (qy * qz + qw * qx)) * sy

    const m02 = (2 * (qx * qz + qw * qy)) * sz
    const m12 = (2 * (qy * qz - qw * qx)) * sz
    const m22 = (1 - 2 * (qx * qx + qy * qy)) * sz

    // Upper triangle of Σ = M·Mᵀ
    const ci = i * 6
    covariances[ci] = m00 * m00 + m01 * m01 + m02 * m02 // M11
    covariances[ci + 1] = m00 * m10 + m01 * m11 + m02 * m12 // M12
    covariances[ci + 2] = m00 * m20 + m01 * m21 + m02 * m22 // M13
    covariances[ci + 3] = m10 * m10 + m11 * m11 + m12 * m12 // M22
    covariances[ci + 4] = m10 * m20 + m11 * m21 + m12 * m22 // M23
    covariances[ci + 5] = m20 * m20 + m21 * m21 + m22 * m22 // M33

    // ---- Colour ------------------------------------------------------------
    let r = 0,
      g = 0,
      b = 0

    if (hasSHColor) {
      // SH DC term → linear RGB
      r = clamp(
        Math.round((0.5 + SH_C0 * readField(splatData, base + fdc0Field.offset, fdc0Field.type, littleEndian)) * 255),
        0,
        255,
      )
      g = clamp(
        Math.round((0.5 + SH_C0 * readField(splatData, base + fdc1Field.offset, fdc1Field.type, littleEndian)) * 255),
        0,
        255,
      )
      b = clamp(
        Math.round((0.5 + SH_C0 * readField(splatData, base + fdc2Field.offset, fdc2Field.type, littleEndian)) * 255),
        0,
        255,
      )
    } else if (hasVertexColor) {
      // Vertex colour — may be uchar [0–255] or float [0–1]
      const rv = readField(splatData, base + redField.offset, redField.type, littleEndian)
      const gv = readField(splatData, base + greenField.offset, greenField.type, littleEndian)
      const bv = readField(splatData, base + blueField.offset, blueField.type, littleEndian)

      if (redField.type === "uchar") {
        r = clamp(Math.round(rv), 0, 255)
        g = clamp(Math.round(gv), 0, 255)
        b = clamp(Math.round(bv), 0, 255)
      } else {
        r = clamp(Math.round(rv * 255), 0, 255)
        g = clamp(Math.round(gv * 255), 0, 255)
        b = clamp(Math.round(bv * 255), 0, 255)
      }
    }

    // ---- Opacity (sigmoid of logit) ----------------------------------------
    const alpha = opacityField
      ? clamp(
          Math.round((1 / (1 + Math.exp(-readField(splatData, base + opacityField.offset, opacityField.type, littleEndian)))) * 255),
          0,
          255,
        )
      : 255

    const ki = i * 4
    colors[ki] = r
    colors[ki + 1] = g
    colors[ki + 2] = b
    colors[ki + 3] = alpha

    // ---- Higher-order SH (bands 1+2+3, up to 15 coefficients per channel) --
    if (shCoeffs) {
      const si = i * 45  // 15 per channel × 3 channels
      for (let j = 0; j < shPerChannel; j++) {
        const rF = frestFields[j]                            // R channel offset j
        const gF = frestFields[frestPerChannel + j]          // G channel offset j
        const bF = frestFields[frestPerChannel * 2 + j]      // B channel offset j
        shCoeffs[si + j]       = rF ? readField(splatData, base + rF.offset, rF.type, littleEndian) : 0
        shCoeffs[si + 15 + j]  = gF ? readField(splatData, base + gF.offset, gF.type, littleEndian) : 0
        shCoeffs[si + 30 + j]  = bF ? readField(splatData, base + bF.offset, bF.type, littleEndian) : 0
      }
    }
  }

  return {
    count,
    positions,
    covariances,
    colors,
    ...(shCoeffs ? { shCoeffs, shDegree } : {}),
    bounds: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  }
}
