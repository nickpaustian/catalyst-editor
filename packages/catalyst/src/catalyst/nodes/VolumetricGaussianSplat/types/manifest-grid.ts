/**
 * manifest-grid.ts
 *
 * Types, parser, and spatial utilities for the VolumetricGaussianSplat
 * uniform grid format. Unlike the octree manifest which uses a hierarchical
 * tree structure, the grid manifest is a flat cell list with spatial
 * culling performed at runtime by recursively halving coordinate ranges.
 *
 * Cell naming convention: "{x}_{y}_{z}" where x, y, z are integer grid
 * coordinates. The world-space bounds of any cell are:
 *   min = gridMin + [x, y, z] * cellSize
 *   max = gridMin + [x+1, y+1, z+1] * cellSize
 *
 * Slice convention:
 *   s0: 0-20% most important splats (always present)
 *   s1: 20-40%
 *   s2: 40-60%
 *   s3: 60-80%
 *   s4: 80-100%
 *
 *   Cells with splatCount < minSplatsForSlicing only have s0 (all splats).
 *   The client uses this rule to compute slice count without per-cell metadata.
 */

import * as THREE from "three"

export interface GridSceneInfo {
  bounding_box: {
    min: [number, number, number]
    max: [number, number, number]
  }
  extent: [number, number, number]
  total_splats: number
}

export interface GridConfig {
  cell_size: number
  grid_cells: [number, number, number]
  file_extension: string
  slices: number
  /** Legacy uniform slice width — kept for backwards compatibility */
  slice_width?: number
  /** Non-uniform band sizes — takes precedence over slice_width if present */
  slice_bands?: number[]
  min_splats_for_slicing: number
}

export interface GridManifest {
  v: number
  scene: GridSceneInfo
  config: GridConfig
  /**
   * Flat cell list. Each entry is [x, y, z, multiplier, splat_count].
   * x, y, z are integer grid coordinates.
   * multiplier = 1 for standard 1u cells, >1 for merged cells (e.g. 4 = 4u cell)
   */
  cells: [number, number, number, number, number][]
}

export interface GridCell {
  id: string
  x: number
  y: number
  z: number
  multiplier: number
  splatCount: number
  sliceCount: number
}

export interface CellBounds {
  min: THREE.Vector3
  max: THREE.Vector3
}
