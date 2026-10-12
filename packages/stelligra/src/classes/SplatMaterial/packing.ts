/**
 * Packed splat layout: 2 RGBA32UI texels (32 bytes) per splat.
 *
 *   texel 0: centre.x, centre.y, centre.z (float bits), RGBA8 colour
 *   texel 1: half2(M11, M12), half2(M13, M22), half2(M23, M33), unused
 *
 * Covariance is multiplied by COV_SCALE before conversion to half so that
 * small splats stay out of the half-float subnormal range.
 */
export const COV_SCALE = 8192
export const UINTS_PER_SPLAT = 8

const HALF_MAX_BITS = 0x7bff

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)

export function floatToHalf(value: number): number {
  f32[0] = value
  const bits = u32[0]
  const sign = (bits >>> 16) & 0x8000
  const exponent = ((bits >>> 23) & 0xff) - 112
  const mantissa = bits & 0x7fffff

  if (exponent >= 31) return sign | HALF_MAX_BITS

  if (exponent <= 0) {
    const shift = 14 - exponent
    if (shift > 24) return sign
    const full = mantissa | 0x800000
    return sign | ((full >>> shift) + ((full >>> (shift - 1)) & 1))
  }

  const rounded = ((exponent << 10) | (mantissa >>> 13)) + ((mantissa >>> 12) & 1)
  return sign | Math.min(rounded, HALF_MAX_BITS)
}

const packHalf2 = (a: number, b: number): number =>
  (floatToHalf(a * COV_SCALE) | (floatToHalf(b * COV_SCALE) << 16)) >>> 0

/**
 * Pack decoder output into the 2-texel layout.
 * centers: count × 4 floats (XYZW), colors: count × 4 bytes as one uint each,
 * covariances: count × 8 floats (6 values + 2 padding).
 */
export function packSplats(
  count: number,
  centers: Float32Array,
  colors: Uint32Array,
  covariances: Float32Array,
): Uint32Array {
  const packed = new Uint32Array(count * UINTS_PER_SPLAT)
  const packedFloats = new Float32Array(packed.buffer)

  for (let i = 0; i < count; i++) {
    const p = i * UINTS_PER_SPLAT
    const c = i * 4
    const v = i * 8

    packedFloats[p] = centers[c]
    packedFloats[p + 1] = centers[c + 1]
    packedFloats[p + 2] = centers[c + 2]
    packed[p + 3] = colors[i]

    packed[p + 4] = packHalf2(covariances[v], covariances[v + 1])
    packed[p + 5] = packHalf2(covariances[v + 2], covariances[v + 3])
    packed[p + 6] = packHalf2(covariances[v + 4], covariances[v + 5])
  }

  return packed
}
