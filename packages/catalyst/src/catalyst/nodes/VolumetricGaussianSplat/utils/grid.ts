import * as THREE from "three"
import type {
  CellBounds,
  GridCell,
  GridConfig,
  GridManifest,
} from "../types"

export function validateGridManifest(data: unknown): GridManifest | null {
  if (!data || typeof data !== "object") return null
  const d = data as Record<string, unknown>
  if (d.v !== 2) return null
  if (!d.scene || !d.config || !Array.isArray(d.cells)) return null
  const config = d.config as Record<string, unknown>
  if (typeof config.cell_size !== "number") return null
  if (!Array.isArray(config.grid_cells) || config.grid_cells.length !== 3)
    return null
  const hasSliceWidth = typeof config.slice_width === "number"
  const hasSliceBands =
    Array.isArray(config.slice_bands) && config.slice_bands.length > 0
  if (!hasSliceWidth && !hasSliceBands) return null
  if (typeof config.file_extension !== "string") return null
  if (typeof config.slices !== "number") return null
  if (typeof config.slice_width !== "number") return null
  if (typeof config.min_splats_for_slicing !== "number") return null
  if (d.cells.length > 0 && (d.cells[0] as number[]).length !== 5) {
    throw new Error(
      `VGS manifest format mismatch: expected 5 elements per cell ` +
        `[x, y, z, multiplier, splat_count] but got ` +
        `${(d.cells[0] as number[]).length}. ` +
        `Re-run the chunker to regenerate the manifest.`,
    )
  }
  return data as GridManifest
}

export const frustumContainsBox = (
  frustum: THREE.Frustum,
  box: THREE.Box3,
): boolean => {
  const planes = frustum.planes
  for (let i = 0; i < 6; i++) {
    const p = planes[i]
    const nx = p.normal.x > 0 ? box.min.x : box.max.x
    const ny = p.normal.y > 0 ? box.min.y : box.max.y
    const nz = p.normal.z > 0 ? box.min.z : box.max.z
    if (p.normal.x * nx + p.normal.y * ny + p.normal.z * nz + p.constant < 0) {
      return false
    }
  }
  return true
}

export const frustumClassifyBox = (
  planes: THREE.Plane[],
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): -1 | 0 | 1 => {
  let fullyInside = true
  for (let i = 0; i < 6; i++) {
    const p = planes[i]
    const nx = p.normal.x,
      ny = p.normal.y,
      nz = p.normal.z,
      d = p.constant

    // Positive vertex — most in plane normal direction
    // If this is outside, entire box is outside
    const posX = nx > 0 ? maxX : minX
    const posY = ny > 0 ? maxY : minY
    const posZ = nz > 0 ? maxZ : minZ
    if (nx * posX + ny * posY + nz * posZ + d < 0) return -1

    // Negative vertex — least in plane normal direction
    // If this is outside, box is not fully contained
    const negX = nx > 0 ? minX : maxX
    const negY = ny > 0 ? minY : maxY
    const negZ = nz > 0 ? minZ : maxZ
    if (nx * negX + ny * negY + nz * negZ + d < 0) fullyInside = false
  }
  return fullyInside ? 1 : 0
}

/**
 * Parse a GridManifest into a flat cell index for O(1) lookup by id,
 * and a 3D lookup for O(1) lookup by grid coordinates.
 *
 * Called once on load. Bounding boxes are computed on demand via
 * getCellBounds rather than stored per-cell.
 */
export function parseGridManifest(
  manifest: GridManifest,
  cellIndex: Map<string, GridCell>,
  spatialIndex: Map<number, GridCell>,
): void {
  const { slices, min_splats_for_slicing } = manifest.config

  const raw = manifest.cells.find(
    ([x, y, z, mult]) => x === 6 && y === 35 && z === 36 && mult === 1,
  )
  console.log("Raw manifest row for 6_35_36:", raw)

  for (const [x, y, z, multiplier, splatCount] of manifest.cells) {
    // Validate spatial key constraints
    if (x >= 1000 || y >= 1000 || z >= 1000) {
      throw new Error(
        `VGS spatial index overflow: cell ${x}_${y}_${z} exceeds max grid dimension of 999. ` +
          `Reduce cell size or increase the spatial key formula limits.`,
      )
    }
    if (multiplier >= 100) {
      throw new Error(
        `VGS spatial index overflow: cell multiplier ${multiplier} exceeds max of 99. ` +
          `Reduce --max-rollup-size to below 100.`,
      )
    }

    const id =
      multiplier === 1 ? `${x}_${y}_${z}` : `${x}_${y}_${z}@${multiplier}`
    const sliceCount = splatCount < min_splats_for_slicing ? 1 : slices
    const cell: GridCell = { id, x, y, z, multiplier, splatCount, sliceCount }

    cellIndex.set(id, cell)

    const spatialKey = x * 100000000 + y * 100000 + z * 100 + multiplier
    spatialIndex.set(spatialKey, cell)
  }
}

/**
 * Get the band sizes for a manifest config.
 * Prefers slice_bands if present, falls back to uniform slice_width.
 */
export function getSliceBands(config: GridConfig): number[] {
  if (config.slice_bands && config.slice_bands.length > 0) {
    return config.slice_bands
  }
  // Legacy uniform bands
  const width = config.slice_width ?? 1 / config.slices
  return Array(config.slices).fill(width)
}

/**
 * Cost in splats for a given slice index.
 */
export function getSliceSplatCost(
  cell: GridCell,
  sliceIndex: number,
  bands: number[],
): number {
  if (cell.sliceCount === 1) return cell.splatCount // small cell, all in s0
  return Math.round(cell.splatCount * (bands[sliceIndex] ?? 0))
}

/**
 * Compute world-space bounds for a cell from its grid coordinates.
 * No manifest lookup needed — pure arithmetic from grid origin and cell size.
 */
export function getCellBounds(
  x: number,
  y: number,
  z: number,
  gridMin: [number, number, number],
  cellSize: number,
): CellBounds {
  return {
    min: new THREE.Vector3(
      gridMin[0] + x * cellSize,
      gridMin[1] + y * cellSize,
      gridMin[2] + z * cellSize,
    ),
    max: new THREE.Vector3(
      gridMin[0] + (x + 1) * cellSize,
      gridMin[1] + (y + 1) * cellSize,
      gridMin[2] + (z + 1) * cellSize,
    ),
  }
}

/**
 * Reusable variant — writes into provided vectors to avoid allocation
 * during per-frame traversal.
 */
export function getCellBoundsInto(
  x: number,
  y: number,
  z: number,
  multiplier: number,
  gridMin: [number, number, number],
  cellSize: number,
  outMin: THREE.Vector3,
  outMax: THREE.Vector3,
): void {
  const size = cellSize * multiplier
  outMin.set(
    gridMin[0] + x * cellSize,
    gridMin[1] + y * cellSize,
    gridMin[2] + z * cellSize,
  )
  outMax.set(
    gridMin[0] + x * cellSize + size,
    gridMin[1] + y * cellSize + size,
    gridMin[2] + z * cellSize + size,
  )
}

/**
 * Compute world-space bounds for a range of grid coordinates.
 * Used during hierarchical range culling to check whether an entire
 * sub-grid can be culled before descending to individual cells.
 */
export function getRangeBoundsInto(
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  zMin: number,
  zMax: number,
  gridMin: [number, number, number],
  cellSize: number,
  outMin: THREE.Vector3,
  outMax: THREE.Vector3,
): void {
  outMin.set(
    gridMin[0] + xMin * cellSize,
    gridMin[1] + yMin * cellSize,
    gridMin[2] + zMin * cellSize,
  )
  outMax.set(
    gridMin[0] + xMax * cellSize,
    gridMin[1] + yMax * cellSize,
    gridMin[2] + zMax * cellSize,
  )
}

/**
 * Reconstruct the URL for a specific slice of a cell.
 *
 * @param cell     The grid cell
 * @param slice    Slice index 0-4
 * @param baseUrl  Base URL of the GSO folder
 * @param ext      File extension from manifest config (e.g. "sog")
 */
export function getCellSlicePath(
  cell: GridCell,
  slice: number,
  baseUrl: string,
  ext: string,
): string {
  return `${baseUrl}/${cell.id}/s${slice}.${ext}`
}

/**
 * Compute the NDC distance from screen centre for a cell's world-space centre.
 * Returns a value where 0 = dead centre, ~1.4 = corner of screen.
 * Used to prioritise cells closer to the user's focus when allocating budget.
 */
export function getCellNDCDistance(
  x: number,
  y: number,
  z: number,
  multiplier: number,
  gridMin: [number, number, number],
  cellSize: number,
  camera: THREE.PerspectiveCamera,
  scratch: THREE.Vector3,
): number {
  const size = cellSize * multiplier
  scratch.set(
    gridMin[0] + x * cellSize + size * 0.5,
    gridMin[1] + y * cellSize + size * 0.5,
    gridMin[2] + z * cellSize + size * 0.5,
  )
  scratch.project(camera)
  return Math.sqrt(scratch.x * scratch.x + scratch.y * scratch.y)
}
