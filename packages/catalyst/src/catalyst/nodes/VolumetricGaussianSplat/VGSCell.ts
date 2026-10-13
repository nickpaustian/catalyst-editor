/**
 *
 * Self-managing cell for VolumetricGaussianSplat.
 *
 * Each slice is allocated a permanent slot range on the GPU texture once.
 * Slice processing (decode + world transform + scatter) happens in the
 * SliceProcessorPool off the main thread. Quality changes are bitmask-only.
 *
 * Desired level semantics:
 *   -1  = hidden (all slices hidden)
 *    1  = show s0 only
 *    2  = show s0 + s1
 *    N  = show s0 through s(N-1)
 */

import * as THREE from "three"
import type { SplatRenderer } from "@vitrine/stelligra"
import type { SliceProcessorPool } from "./SliceProcessorPool"
import type { GridCell } from "./types"
import { getCellBoundsInto } from "./utils"
import { debug, trace } from "@vitrine/debug"

export interface CellFetchRequest {
  cellId: string
  slice: number
  distance: number
  ndcDistance: number
  qualityGap: number
  isBaseSlice: boolean
  isDesired: boolean
  desiredLevel: number
  staleness: number
}

export interface VGSCellConfig {
  cell: GridCell
  renderer: SplatRenderer
  processorPool: SliceProcessorPool
  gridMin: [number, number, number]
  cellSize: number
  /** World matrix elements (Float32Array[16]) for pre-baking transforms. */
  worldMatrix: Float32Array
  shBands: number
}

export class VGSCell {
  readonly id: string
  readonly cell: GridCell

  private _config: VGSCellConfig

  // Per-slice allocation IDs on the SplatRenderer GPU texture.
  // null = not yet allocated (slice not loaded).
  private _sliceAllocIds: (number | null)[]

  // Per-slice splat counts
  private _sliceCounts: number[]

  // Whether each slice is currently shown on GPU
  private _sliceShown: boolean[]

  // Track in-flight injections to prevent duplicate processing
  private _sliceProcessing: boolean[]

  private _desiredLevel: number = -1
  private _disposed: boolean = false

  // Job ID counter for worker pool requests
  private static _nextJobId = 0

  // Reusable for bounds calculation
  private _boundsMin = new THREE.Vector3()
  private _boundsMax = new THREE.Vector3()
  private _boundsBox = new THREE.Box3()

  constructor(config: VGSCellConfig) {
    this._config = config
    this.id = config.cell.id
    this.cell = config.cell
    this._sliceAllocIds = Array(config.cell.sliceCount).fill(null)
    this._sliceCounts = Array(config.cell.sliceCount).fill(0)
    this._sliceShown = Array(config.cell.sliceCount).fill(false)
    this._sliceProcessing = Array(config.cell.sliceCount).fill(false)
  }

  //=========================
  // Desired level
  //=========================

  setDesiredLevel(level: number): void {
    const resolved = level < 1 ? -1 : level
    if (resolved === this._desiredLevel) return
    this._desiredLevel = resolved
    this._sync()
  }

  get desiredLevel(): number {
    return this._desiredLevel
  }

  get displayedLevel(): number {
    let shown = 0
    for (let s = 0; s < this.cell.sliceCount; s++) {
      if (this._sliceShown[s]) shown++
      else break
    }
    return shown
  }

  get qualityGap(): number {
    if (this._desiredLevel === -1) return 0
    return Math.max(0, this._desiredLevel - this.displayedLevel)
  }

  nextNeededSlice(): number | null {
    if (this._desiredLevel === -1) return null
    for (let s = 0; s < this._desiredLevel; s++) {
      if (this._sliceAllocIds[s] === null && !this._sliceProcessing[s]) return s
    }
    return null
  }

  hasSlice(s: number): boolean {
    return this._sliceAllocIds[s] !== null
  }

  //=========================
  // Scene sync — bitmask only
  //=========================

  private _sync(): void {
    if (this._disposed) return

    for (let s = 0; s < this.cell.sliceCount; s++) {
      const allocId = this._sliceAllocIds[s]
      if (allocId === null) continue

      const shouldShow = this._desiredLevel !== -1 && s < this._desiredLevel

      if (shouldShow && !this._sliceShown[s]) {
        this._config.renderer.showSlice(allocId)
        this._sliceShown[s] = true
      } else if (!shouldShow && this._sliceShown[s]) {
        this._config.renderer.hideSlice(allocId)
        this._sliceShown[s] = false
      }
    }
  }

  //=========================
  // Slice injection — off-thread processing
  //=========================

  /**
   * Process a SOG buffer off-thread via the SliceProcessorPool.
   * Decode + world transform + scatter all happen in a worker.
   * Main thread only does the final GL upload when the worker returns.
   */
  public injectSlice(
    s: number,
    buffer: ArrayBuffer,
    renderer: THREE.WebGLRenderer,
  ): void {
    if (this._disposed) return
    if (this._sliceAllocIds[s] !== null) return
    if (this._sliceProcessing[s]) return

    this._sliceProcessing[s] = true

    // Allocate GPU slot range now — before worker returns so slot is reserved
    // We need count but don't know it yet. We'll use a sentinel allocation
    // approach: allocate after worker returns with actual count.
    // Buffer is transferred to worker (zero copy).

    const jobId = VGSCell._nextJobId++
    const tQueued = performance.now()

    this._config.processorPool
      .process({
        type: "process",
        id: jobId,
        buffer,
        worldMatrix: this._config.worldMatrix,
        shBands: this._config.shBands,
      })
      .then((result) => {
        if (this._disposed) return
        if (this._sliceAllocIds[s] !== null) return

        const tReceived = performance.now()
        trace(
          `[VGSCell] id=${jobId} cell=${this.id} slice=${s} ` +
            `roundTrip=${(tReceived - tQueued).toFixed(1)}ms`,
          "VGS",
        )

        // Allocate permanent slot with actual count from worker
        const allocId = this._config.renderer.allocateSlice(
          result.count,
          s,
          () => this.handleSliceEviction(s),
        )
        if (allocId === -1) {
          // GPU at hard cap, couldn't evict enough — skip this slice
          debug(`Alloc failed, dropping ${this.id}:${s}`, "VGS")
          this._sliceProcessing[s] = false
          return
        }

        // Upload packed data — O(1) GL calls, no main thread CPU work
        this._config.renderer.uploadPacked(
          allocId,
          result.packed,
          result.positions,
          result.sh,
          result.boundsMin,
          result.boundsMax,
          renderer,
        )

        this._sliceAllocIds[s] = allocId
        this._sliceCounts[s] = result.count
        this._sliceProcessing[s] = false

        // uploadPacked shows by default — hide if not in desired level
        if (this._desiredLevel !== -1 && s < this._desiredLevel) {
          this._sliceShown[s] = true
        } else {
          this._config.renderer.hideSlice(allocId)
          this._sliceShown[s] = false
        }
      })
      .catch((error) => {
        console.error("Slice processing failed:", error)
        this._sliceProcessing[s] = false
      })
  }

  private handleSliceEviction(s: number): void {
    this._sliceAllocIds[s] = null
    this._sliceCounts[s] = 0
    this._sliceShown[s] = false
    this._sliceProcessing[s] = false
  }

  //=========================
  // Spatial
  //=========================

  getBounds(): THREE.Box3 {
    getCellBoundsInto(
      this.cell.x,
      this.cell.y,
      this.cell.z,
      this.cell.multiplier,
      this._config.gridMin,
      this._config.cellSize,
      this._boundsMin,
      this._boundsMax,
    )
    this._boundsBox.set(this._boundsMin, this._boundsMax)
    return this._boundsBox
  }

  getCentre(out: THREE.Vector3): THREE.Vector3 {
    getCellBoundsInto(
      this.cell.x,
      this.cell.y,
      this.cell.z,
      this.cell.multiplier,
      this._config.gridMin,
      this._config.cellSize,
      this._boundsMin,
      this._boundsMax,
    )
    out.addVectors(this._boundsMin, this._boundsMax).multiplyScalar(0.5)
    return out
  }

  //=========================
  // Stats
  //=========================

  getStats() {
    const displayedLevel = this.displayedLevel
    const loadedSlices = this._sliceAllocIds.filter((id) => id !== null).length
    const processingSlices = this._sliceProcessing.filter(Boolean).length
    const totalSplatsShown = this._sliceCounts
      .slice(0, displayedLevel)
      .reduce((a, b) => a + b, 0)

    return {
      id: this.id,
      desiredLevel: this._desiredLevel,
      displayedLevel,
      qualityGap: this.qualityGap,
      nextNeeded: this.nextNeededSlice(),
      loadedSlices,
      processingSlices,
      totalSlices: this.cell.sliceCount,
      totalSplatsShown,
    }
  }

  //=========================
  // Lifecycle
  //=========================

  dispose(): void {
    this._disposed = true
    for (let s = 0; s < this._sliceAllocIds.length; s++) {
      const allocId = this._sliceAllocIds[s]
      if (allocId !== null) {
        this._config.renderer.freeSlice(allocId)
        this._sliceAllocIds[s] = null
      }
    }
  }
}
