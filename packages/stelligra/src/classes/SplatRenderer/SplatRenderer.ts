import * as THREE from "three"
import {
  SplatMaterial,
  type SplatMaterialOptions,
} from "../SplatMaterial/SplatMaterial"
import { buildSplatGeometry } from "../SplatMaterial/SplatGeometry"
import { SORT_WORKER_CODE } from "../SplatMesh/SortWorker"
import { debug, trace } from "@vitrine/debug"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const SORT_MOVE_THRESHOLD = 0.001
const SORT_TURN_THRESHOLD = 0.0005

export interface SplatRendererOptions extends SplatMaterialOptions {
  /**
   * Cull splats outside the view frustum before sorting. The margin widens
   * with camera angular velocity so a lagging sort still covers the screen
   * edges while turning. Off by default.
   */
  sortFrustumCull?: boolean
  /** Extra angle (radians) kept around the frustum when culling. Default 0.1. */
  sortCullBaseAngle?: number
  minResidentSliceLevel?: number
}

export interface SplatRendererStats {
  sortsDispatched: number
  sortsCompleted: number
  sortMsTotal: number
  sortMsMax: number
  visibleCount: number
  uploadBatches: number
  uploadedSplats: number
  uploadMsTotal: number
}

export interface BenchmarkResult {
  iterations: number
  splats: number
  msPerSort: number
}

/**
 * A permanently allocated slice range on the GPU texture.
 * Once allocated, the slot range is never moved — only shown/hidden
 * via the dead mask.
 */
interface SliceAllocation {
  slotStart: number
  count: number
  /** World-space AABB for frustum culling. Null until first upload. */
  worldBox: THREE.Box3 | null
  /** Whether this slice is currently hidden (dead bits set). */
  hidden: boolean
  /** Whether this slice has been evicted (slot freed for reuse). */
  evicted: boolean
  /** Last frame this slice was desired — used for LRU eviction. */
  lastDesiredFrame: number
  sliceLevel: number
  protected: boolean
  onEvict?: () => void
}

/** Entry in the slot free-list, kept sorted by start index. */
interface FreeRange {
  start: number
  count: number
}

// ---------------------------------------------------------------------------
// SplatRenderer
// ---------------------------------------------------------------------------

export class SplatRenderer extends THREE.Mesh {
  private _splatMat: SplatMaterial
  private _instancedGeom: THREE.InstancedBufferGeometry
  private _geomCapacity = 0

  // ---- Slot allocator -------------------------------------------------------
  private _hwm = 0
  private _freeList: FreeRange[] = []
  private _aliveCount = 0
  private _bufferCapacity = 0
  private _sortCount = 0

  // Dead-mask: 1 bit per slot. Set = excluded from sort.
  // Positions live in the sort worker; only the mask is sent, and only when changed.
  private _deadMask = new Uint8Array(0)
  private _deadMaskDirty = true

  // ---- Slice allocations ----------------------------------------------------
  private _allocations: Map<number, SliceAllocation> = new Map()
  private _nextAllocId = 0
  private _minResidentSliceLevel = 0

  // ---- Pending GPU uploads --------------------------------------------------
  // Packed slices received from workers, uploaded at the start of the next update.
  private _pendingUploads: Array<{
    slotStart: number
    count: number
    packed: Uint32Array
    sh: Uint32Array
  }> = []

  // ---- Stateless sort worker ------------------------------------------------
  private _worker: Worker | null = null
  private _workerUrl: string | null = null
  private _sortPending = false
  private _benchmarkResolve: ((r: BenchmarkResult) => void) | null = null
  private _sortBuffer: ArrayBuffer | null = null
  private _sortFrustumCull: boolean
  private _sortCullBaseAngle: number
  private _lastSortQuat = new THREE.Quaternion()
  private _lastSortPosition = new THREE.Vector3()
  private _hasSorted = false
  private _lastSortMs = 0
  private _stats: SplatRendererStats = {
    sortsDispatched: 0,
    sortsCompleted: 0,
    sortMsTotal: 0,
    sortMsMax: 0,
    visibleCount: 0,
    uploadBatches: 0,
    uploadedSplats: 0,
    uploadMsTotal: 0,
  }

  // ---- Frame counter --------------------------------------------------------
  private _frame = 0

  // ---- Reusable temporaries ------------------------------------------------
  private _rendererSize = new THREE.Vector2()
  private _mvMatrix = new THREE.Matrix4()
  private _mvpMatrix = new THREE.Matrix4()

  constructor(options: SplatRendererOptions = {}) {
    const mat = new SplatMaterial(options)
    const geom = buildSplatGeometry(0)
    super(geom, mat)

    this._splatMat = mat
    this._instancedGeom = geom
    this._sortFrustumCull = options.sortFrustumCull ?? false
    this._sortCullBaseAngle = options.sortCullBaseAngle ?? 0.1
    this._minResidentSliceLevel = options.minResidentSliceLevel ?? 0

    this.matrixAutoUpdate = false
    this.frustumCulled = false

    this._initSortWorker()
  }

  // ---- Public API -----------------------------------------------------------

  get splatCount(): number {
    return this._aliveCount
  }

  get frameCount(): number {
    return this._frame
  }

  /** Allocated slot capacity (hard cap on resident splats). */
  get capacity(): number {
    return this._bufferCapacity
  }

  /** Duration of the most recent sort in the worker, in ms. */
  get lastSortMs(): number {
    return this._lastSortMs
  }

  /** Running totals since creation, for benchmarking. */
  get stats(): Readonly<SplatRendererStats> {
    return this._stats
  }

  /**
   * Pre-allocate GPU texture and geometry for exactly `n` splat slots.
   * Call this once at startup with your splat budget — this is your hard
   * GPU memory commitment. No further allocation happens after this.
   */
  public reserveCapacity(n: number): void {
    if (n === this._bufferCapacity) return

    if (n < this._bufferCapacity && this._hwm === 0) {
      this._bufferCapacity = 0
      this._deadMask = new Uint8Array(0)
    }

    if (n > this._bufferCapacity) {
      this._allocateExact(n)
    }
  }

  private _allocateExact(cap: number): void {
    debug(
      `SplatRenderer reserving capacity: ${cap.toLocaleString()} splats`,
      "SPLAT-RENDERER",
    )
    this._deadMask = new Uint8Array(Math.ceil(cap / 32) * 4)
    this._deadMaskDirty = true
    this._bufferCapacity = cap
    this._worker?.postMessage({ type: "reserve", capacity: cap })
  }

  /**
   * Allocate a permanent slot range for `count` splats.
   * Returns an allocation ID used for all subsequent operations.
   * The slot range is never moved after allocation.
   *
   * Does NOT upload any data — call uploadSlice() after.
   */
  public allocateSlice(
    count: number,
    sliceLevel: number,
    onEvict?: () => void,
  ): number {
    const slotStart = this._allocSlots(count, sliceLevel)
    if (slotStart === -1) return -1
    const id = this._nextAllocId++

    const alloc: SliceAllocation = {
      slotStart,
      count,
      worldBox: null,
      hidden: true, // starts hidden until uploadSlice is called
      evicted: false,
      lastDesiredFrame: this._frame,
      sliceLevel,
      protected: false,
      onEvict,
    }

    this._allocations.set(id, alloc)
    return id
  }

  /**
   * Queue packed splats (see SplatMaterial/packing.ts) for a previously
   * allocated slot range. `positions` (count × 4, XYZW) go to the sort worker.
   * No O(N) CPU work on the main thread.
   */
  public uploadPacked(
    allocId: number,
    packed: Uint32Array,
    positions: Float32Array,
    sh: Uint32Array,
    boundsMin: Float32Array,
    boundsMax: Float32Array,
    renderer: THREE.WebGLRenderer,
  ): void {
    const alloc = this._allocations.get(allocId)
    if (!alloc) return
    trace(
      `uploadPacked: allocId=${allocId} slotStart=${alloc.slotStart} ` +
        `count=${alloc.count} pendingUploads=${this._pendingUploads.length} ` +
        `frame=${this._frame}`,
      "SPLAT-RENDERER",
    )

    const { slotStart, count } = alloc

    // Ensure GPU textures are initialised
    this._splatMat.allocateForCapacity(this._bufferCapacity, renderer)

    // Hand positions to the sort worker, which keeps them resident.
    this._worker?.postMessage(
      { type: "positions", slotStart, count, data: positions },
      [positions.buffer],
    )

    this._pendingUploads.push({ slotStart, count, packed, sh })

    // Set world-space AABB from worker result
    alloc.worldBox = new THREE.Box3(
      new THREE.Vector3(boundsMin[0], boundsMin[1], boundsMin[2]),
      new THREE.Vector3(boundsMax[0], boundsMax[1], boundsMax[2]),
    )
    alloc.evicted = false
    alloc.lastDesiredFrame = this._frame

    // Show immediately — clear dead bits
    this._clearDeadBits(slotStart, count)
    alloc.hidden = false
    this._aliveCount += count
    this._sortCount = this._hwm
  }

  /**
   * Show a slice — clear its dead bits so the sort worker includes it.
   */
  showSlice(allocId: number): void {
    const alloc = this._allocations.get(allocId)
    if (!alloc || !alloc.hidden || alloc.evicted) return
    this._clearDeadBits(alloc.slotStart, alloc.count)
    alloc.hidden = false
    alloc.lastDesiredFrame = this._frame
    this._aliveCount += alloc.count
    this._sortCount = this._hwm
    trace(
      `showSlice: allocId=${allocId} slotStart=${alloc.slotStart} count=${alloc.count} frame=${this._frame}`,
      "SPLAT",
    )
  }

  /**
   * Hide a slice — set its dead bits so the sort worker skips it.
   * Data remains on GPU, can be shown again instantly with showSlice().
   */
  hideSlice(allocId: number): void {
    const alloc = this._allocations.get(allocId)
    if (!alloc || alloc.hidden || alloc.evicted) return
    this._setDeadBits(alloc.slotStart, alloc.count)
    alloc.hidden = true
    this._aliveCount -= alloc.count
    this._sortCount = this._hwm
  }

  /**
   * Evict a slice — zero its alpha on GPU and free its slot range for reuse.
   * Call this when GPU memory pressure requires freeing space.
   * After eviction, allocateSlice + uploadSlice must be called again to restore.
   */
  public evictSlice(allocId: number): void {
    const alloc = this._allocations.get(allocId)
    if (!alloc || alloc.evicted) return

    if (!alloc.hidden) {
      this._aliveCount -= alloc.count
    }

    // Zero on GPU so it disappears immediately, and drop any upload still queued
    this._pendingUploads = this._pendingUploads.filter(
      (upload) => upload.slotStart !== alloc.slotStart,
    )
    this._splatMat.zeroSlots(alloc.slotStart, alloc.count)

    // Free slot for reuse
    this._freeSlots(alloc.slotStart, alloc.count)
    alloc.evicted = true
    alloc.hidden = true
    this._sortCount = this._hwm
    alloc.onEvict?.()
  }

  /**
   * Free an allocation entirely — evicts if needed and removes the record.
   */
  freeSlice(allocId: number): void {
    const alloc = this._allocations.get(allocId)
    if (!alloc) return

    if (!alloc.evicted) {
      this.evictSlice(allocId)
    }

    this._allocations.delete(allocId)
  }

  /**
   * Returns the allocation record for inspection.
   */
  getAllocation(allocId: number): Readonly<SliceAllocation> | undefined {
    return this._allocations.get(allocId)
  }

  /**
   * Returns all allocations sorted by lastDesiredFrame ascending (LRU first).
   * Useful for eviction decisions.
   */
  /**
   * Eviction candidates, best victim first. Hidden slices always go before
   * visible ones. A visible slice is only offered when it is finer than
   * `forSliceLevel` — a detail slice arriving must never punch a hole in
   * coarser content that is on screen.
   */
  getLRUAllocations(
    forSliceLevel = Infinity,
  ): Array<{ id: number; alloc: SliceAllocation }> {
    const minLevel = this._minResidentSliceLevel

    return Array.from(this._allocations.entries())
      .map(([id, alloc]) => ({ id, alloc }))
      .filter(
        ({ alloc }) =>
          !alloc.evicted &&
          alloc.sliceLevel > minLevel &&
          (alloc.hidden || alloc.sliceLevel > forSliceLevel),
      )
      .sort((a, b) => {
        if (a.alloc.hidden !== b.alloc.hidden) return a.alloc.hidden ? -1 : 1
        return this.evictionScore(b.alloc) - this.evictionScore(a.alloc)
      })
  }

  private evictionScore(alloc: SliceAllocation): number {
    const staleness = this._frame - alloc.lastDesiredFrame

    // Size weight — larger slices are more valuable to evict
    // Normalised loosely around a typical mid-size slice (~500 splats)
    const sizeWeight = Math.log1p(alloc.count / 500)

    // Level weight — higher slices are more expendable
    // sliceLevel 0 = most important, 8 = least important
    const levelMultiplier = 1 + (alloc.sliceLevel ?? 0) * 0.5

    return staleness * sizeWeight * levelMultiplier
  }

  update(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): void {
    this._frame++

    renderer.getDrawingBufferSize(this._rendererSize)
    this._splatMat.updateFromCamera(
      camera,
      this._rendererSize.x,
      this._rendererSize.y,
    )

    if (this._pendingUploads.length > 0) {
      this._applyPendingOps(renderer)
    }

    if (this._aliveCount === 0) return
    if (!this._worker) return
    if (this._sortPending) return
    if (this._sortCount === 0) return

    if (this._hasSorted && !this._deadMaskDirty) {
      const moved =
        camera.position.distanceTo(this._lastSortPosition) >
        SORT_MOVE_THRESHOLD
      const turned =
        this._sortFrustumCull &&
        this._lastSortQuat.angleTo(camera.quaternion) > SORT_TURN_THRESHOLD
      if (!moved && !turned) return
    }

    this._sortPending = true
    this._stats.sortsDispatched++
    this._dispatchSort(camera, "sort")
  }

  async benchmark(
    camera: THREE.PerspectiveCamera,
    _renderer: THREE.WebGLRenderer,
    iterations = 100,
  ): Promise<BenchmarkResult> {
    if (!this._worker)
      throw new Error("SplatRenderer: sort worker not initialised")
    if (this._benchmarkResolve)
      throw new Error("SplatRenderer: benchmark already in progress")
    if (this._aliveCount === 0)
      throw new Error("SplatRenderer: no splats loaded")

    return new Promise((resolve) => {
      this._benchmarkResolve = resolve
      this._dispatchSort(camera, "benchmark", iterations)
    })
  }

  dispose(): void {
    if (this._worker) {
      this._worker.terminate()
      this._worker = null
    }
    if (this._workerUrl) {
      URL.revokeObjectURL(this._workerUrl)
      this._workerUrl = null
    }
    this._allocations.clear()
    this._pendingUploads = []
    this._freeList = []
    this._aliveCount = 0
    this._hwm = 0
    this._sortCount = 0
    this._bufferCapacity = 0
    this._deadMask = new Uint8Array(0)
    this._sortBuffer = null
    this._instancedGeom.dispose()
    this._splatMat.dispose()
  }

  // ---- Sort worker ----------------------------------------------------------

  private _initSortWorker(): void {
    const blob = new Blob([SORT_WORKER_CODE], {
      type: "application/javascript",
    })
    this._workerUrl = URL.createObjectURL(blob)
    this._worker = new Worker(this._workerUrl)
    this._worker.onmessage = (e: MessageEvent) => this._onSortMessage(e)
  }

  private _dispatchSort(
    camera: THREE.PerspectiveCamera,
    type: "sort" | "benchmark",
    iterations = 0,
  ): void {
    const count = this._sortCount
    if (count === 0) {
      this._sortPending = false
      return
    }

    this._mvMatrix.copy(camera.matrixWorldInverse)
    this._mvpMatrix.multiplyMatrices(camera.projectionMatrix, this._mvMatrix)

    const [cullMarginX, cullMarginY] = this._sortFrustumCull
      ? this._cullMargins(camera)
      : [0, 0]
    this._lastSortQuat.copy(camera.quaternion)
    this._lastSortPosition.copy(camera.position)
    this._hasSorted = true

    const msg: Record<string, unknown> = {
      type,
      camPos: [camera.position.x, camera.position.y, camera.position.z],
      mvp: this._mvpMatrix.elements,
      cullMarginX,
      cullMarginY,
      count,
      iterations,
    }
    if (this._deadMaskDirty) {
      msg.deadMask = this._deadMask.slice(0, Math.ceil(count / 32) * 4)
      this._deadMaskDirty = false
    }

    const transferables: Transferable[] = []
    if (type === "sort" && this._sortBuffer) {
      msg.indicesBuffer = this._sortBuffer
      transferables.push(this._sortBuffer)
      this._sortBuffer = null
    }
    this._worker!.postMessage(msg, transferables)
  }

  /**
   * Clip-space cull margins. The frustum is widened by a base angle plus the
   * rotation since the last sort (×2 to cover the frames until the result
   * lands), so splats about to rotate into view are already in the sorted set.
   */
  private _cullMargins(camera: THREE.PerspectiveCamera): [number, number] {
    const turned = this._lastSortQuat.angleTo(camera.quaternion)
    const extra = this._sortCullBaseAngle + turned * 2
    const halfY = THREE.MathUtils.degToRad(camera.fov) / 2
    const halfX = Math.atan(Math.tan(halfY) * camera.aspect)
    const limit = Math.PI / 2 - 0.01
    // Past ~90° the frustum no longer bounds anything useful — disable culling
    if (halfX + extra >= limit) return [0, 0]
    return [
      Math.tan(halfX + extra) / Math.tan(halfX),
      Math.tan(Math.min(halfY + extra, limit)) / Math.tan(halfY),
    ]
  }

  private _onSortMessage(e: MessageEvent): void {
    const msg = e.data as {
      type: string
      indices?: Uint32Array
      visibleCount?: number
      msSort?: number
      msPerSort?: number
      iterations?: number
      splats?: number
    }

    if (msg.type === "benchmarkResult" && this._benchmarkResolve) {
      const resolve = this._benchmarkResolve
      this._benchmarkResolve = null
      resolve(e.data as BenchmarkResult)
      return
    }

    if (
      msg.type === "sorted" &&
      msg.indices &&
      msg.visibleCount !== undefined
    ) {
      const indices = msg.indices
      const visibleCount = msg.visibleCount
      const attr = this._instancedGeom.attributes
        .splatIndex as THREE.InstancedBufferAttribute
      ;(attr.array as Uint32Array).set(indices.subarray(0, visibleCount))
      // Upload only the sorted range, not the whole capacity-sized buffer
      attr.clearUpdateRanges()
      attr.addUpdateRange(0, visibleCount)
      attr.needsUpdate = true
      this._instancedGeom.instanceCount = visibleCount

      this._sortBuffer = indices.buffer as ArrayBuffer
      this._lastSortMs = msg.msSort ?? 0
      this._stats.sortsCompleted++
      this._stats.sortMsTotal += this._lastSortMs
      this._stats.sortMsMax = Math.max(this._stats.sortMsMax, this._lastSortMs)
      this._stats.visibleCount = visibleCount
      this._sortPending = false
      trace(
        `Sort returned frame=${this._frame} visibleCount=${visibleCount}`,
        "SPLAT",
      )
    }
  }

  // ---- Slot allocator -------------------------------------------------------

  private _allocSlots(count: number, sliceLevel: number): number {
    // Pass 1 — try free list first (exact match preferred)
    for (let i = 0; i < this._freeList.length; i++) {
      const f = this._freeList[i]
      if (f.count === count) {
        this._freeList.splice(i, 1)
        trace(
          `_allocSlots: free list exact match start=${f.start} count=${count}`,
          "SPLAT-RENDERER",
        )
        return f.start
      }
      if (f.count > count) {
        const start = f.start
        f.start += count
        f.count -= count
        trace(
          `_allocSlots: free list split start=${start} count=${count}`,
          "SPLAT-RENDERER",
        )
        return start
      }
    }

    // Pass 2 — would extending HWM exceed hard cap?
    const hardCap = this._bufferCapacity
    if (hardCap > 0 && this._hwm + count > hardCap) {
      // Evict LRU slices until we have room in free list or HWM
      const lru = this.getLRUAllocations(sliceLevel)
      for (const { id } of lru) {
        this.evictSlice(id)

        // Re-check free list after each eviction
        for (let i = 0; i < this._freeList.length; i++) {
          const f = this._freeList[i]
          if (f.count === count) {
            this._freeList.splice(i, 1)
            return f.start
          }
          if (f.count > count) {
            const start = f.start
            f.start += count
            f.count -= count
            return start
          }
        }

        // HWM may have shrunk via _freeSlots coalescing to end
        if (this._hwm + count <= hardCap) break
      }

      // Still no room after all evictions — hard cap genuinely exhausted
      if (this._hwm + count > hardCap) {
        debug(
          `SplatRenderer: hard cap exhausted (${hardCap.toLocaleString()} splats), ` +
            `cannot allocate ${count} — dropping slice`,
          "SPLAT-RENDERER",
        )
        return -1 // caller must check for -1
      }
    }

    // Pass 3 — extend HWM
    const start = this._hwm
    this._hwm += count

    // Only grow buffers if no hard cap (organic growth mode, no probe)
    if (this._hwm > this._bufferCapacity && hardCap === 0) {
      this._growCapacity(this._hwm)
    }

    trace(
      `_allocSlots: HWM extend start=${start} count=${count} hwm=${this._hwm}`,
      "SPLAT-RENDERER",
    )
    this._setDeadBits(start, count)
    return start
  }

  private _setDeadBits(start: number, count: number): void {
    for (let i = start; i < start + count; i++) {
      this._deadMask[i >> 3] |= 1 << (i & 7)
    }
    this._deadMaskDirty = true
  }

  private _clearDeadBits(start: number, count: number): void {
    for (let i = start; i < start + count; i++) {
      this._deadMask[i >> 3] &= ~(1 << (i & 7))
    }
    this._deadMaskDirty = true
  }

  private _freeSlots(start: number, count: number): void {
    this._setDeadBits(start, count)

    const range: FreeRange = { start, count }
    let i = 0
    while (i < this._freeList.length && this._freeList[i].start < start) i++
    this._freeList.splice(i, 0, range)

    if (i + 1 < this._freeList.length) {
      const next = this._freeList[i + 1]
      if (range.start + range.count === next.start) {
        range.count += next.count
        this._freeList.splice(i + 1, 1)
      }
    }
    if (i > 0) {
      const prev = this._freeList[i - 1]
      if (prev.start + prev.count === range.start) {
        prev.count += range.count
        this._freeList.splice(i, 1)
        i--
      }
    }
    const last = this._freeList[this._freeList.length - 1]
    if (last && last.start + last.count === this._hwm) {
      this._hwm -= last.count
      this._freeList.pop()
    }
  }

  private _growCapacity(required: number): void {
    const cap = this._nextBufCap(required)
    debug(
      `SplatRenderer growing capacity: ${this._bufferCapacity.toLocaleString()} → ${cap.toLocaleString()} splats (required: ${required.toLocaleString()})`,
    )

    const maskBytes = Math.ceil(cap / 32) * 4
    if (maskBytes > this._deadMask.length) {
      const b = new Uint8Array(maskBytes)
      b.set(this._deadMask)
      this._deadMask = b
    }
    this._worker?.postMessage({ type: "reserve", capacity: cap })

    this._bufferCapacity = cap
  }

  // ---- Pending ops ----------------------------------------------------------

  private _applyPendingOps(renderer: THREE.WebGLRenderer): void {
    if (this._pendingUploads.length === 0) return

    const t0 = performance.now()

    this._splatMat.allocateForCapacity(this._bufferCapacity, renderer)
    this._growGeometry()

    for (const { slotStart, count, packed, sh } of this._pendingUploads) {
      this._splatMat.uploadPacked(slotStart, count, packed)
      this._splatMat.uploadSH(slotStart, count, sh)
      this._stats.uploadedSplats += count
    }
    this._pendingUploads = []
    this._sortCount = this._hwm

    const uploadMs = performance.now() - t0
    this._stats.uploadBatches++
    this._stats.uploadMsTotal += uploadMs
    trace(
      `_applyPendingOps: ${uploadMs.toFixed(1)}ms`,
      "SPLAT-RENDERER",
    )
  }

  private _growGeometry(): void {
    if (this._bufferCapacity <= this._geomCapacity) return
    const newGeom = buildSplatGeometry(this._bufferCapacity)
    const oldVis = this._instancedGeom.instanceCount
    if (oldVis > 0) {
      const oldAttr = this._instancedGeom.attributes
        .splatIndex as THREE.InstancedBufferAttribute
      const newAttr = newGeom.attributes
        .splatIndex as THREE.InstancedBufferAttribute
      ;(newAttr.array as Uint32Array).set(
        (oldAttr.array as Uint32Array).subarray(0, oldVis),
      )
      newAttr.needsUpdate = true
      newGeom.instanceCount = oldVis
    }
    this._instancedGeom.dispose()
    this._instancedGeom = newGeom
    this._geomCapacity = this._bufferCapacity
    this.geometry = this._instancedGeom
  }

  // ---- Helpers --------------------------------------------------------------

  private _nextBufCap(required: number): number {
    if (this._bufferCapacity === 0) return required * 2
    return Math.max(required, this._bufferCapacity * 2)
  }
}
