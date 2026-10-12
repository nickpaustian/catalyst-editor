/**
 * GPU-ready data for a Gaussian splat scene, produced by the PLY parser.
 * All heavy lifting (covariance computation, sigmoid/exp transforms) is done
 * once at parse time so the renderer never has to touch it again.
 */
export interface GaussianSplatData {
  /** Total number of splats */
  count: number

  /**
   * Splat center positions, count × 3 floats [x, y, z, x, y, z, …]
   * World-space, as stored in the PLY file.
   */
  positions: Float32Array

  /**
   * Precomputed upper-triangle of each splat's 3D covariance matrix.
   * count × 6 floats per splat: [M11, M12, M13, M22, M23, M33]
   * Derived from scale and rotation at parse time: Σ = (R·S)(R·S)ᵀ
   */
  covariances: Float32Array

  /**
   * RGBA color per splat, count × 4 bytes [R, G, B, A] in [0, 255].
   * RGB comes from the spherical harmonics DC term (f_dc_0/1/2 → linear RGB).
   * Alpha is the sigmoid-transformed opacity field.
   */
  colors: Uint8Array

  /**
   * Higher-order spherical harmonics coefficients for view-dependent colour.
   * count × 45 floats: 15 coefficients per channel (bands 1, 2, and 3), laid
   * out as [R0…R14, G0…G14, B0…B14] per splat. Coefficients beyond the
   * available degree are zero-padded.  Absent when only the DC term was decoded.
   */
  shCoeffs?: Float32Array

  /**
   * Highest SH degree present in shCoeffs (1, 2, or 3).
   * Absent when shCoeffs is absent.
   */
  shDegree?: 1 | 2 | 3

  bounds: {
    min: [number, number, number]
    max: [number, number, number]
  }
}
