import * as THREE from "three"
import { Catalyst } from "../../core"
import { Node3D } from "../Node3D"
import { debug } from "@vitrine/debug"
import type { GridManifest, GridCell } from "./types"
import {
  validateGridManifest,
  parseGridManifest,
  getCellBoundsInto,
  getCellSlicePath,
  getCellNDCDistance,
  frustumClassifyBox,
} from "./utils"
import { OctantFetcher } from "./OctantFetcher"
import { parseVGSP } from "./VgspParser"
import { VGSCell, type CellFetchRequest } from "./VGSCell"
import { SplatRenderer } from "@vitrine/stelligra"
import { SliceProcessorPool } from "./SliceProcessorPool"

export interface VolumetricGaussianSplatConfig {
  name?: string
  url: string
  gpuCapacity?: number
  frameUploadBudget?: number
  splatBudget?: number
  maxSlice?: number
  minSliceSplats?: number
  maxStaleness?: number
  position?: THREE.Vector3
  rotation?: THREE.Quaternion
  scale?: number
  visualise?: boolean
  frustumExpansion?: number // uniform expansion multiplier (default: 1.2)
  frustumSmear?: number // max asymmetric smear in world units (default: 2.0)
  frustumSmearScale?: number // velocity to smear units multiplier (default: 20)
  frustumSmearFrames?: number
  offScreenMaxSlice?: number // max slice level for expanded frustum cells (default: 2

  // --- Renderer ---
  /** Velocity-aware frustum cull in the sort worker (default: false) */
  sortFrustumCull?: boolean
  /** Fraction of GPU capacity the budget may use; rest absorbs fragmentation (default: 0.85) */
  gpuBudgetHeadroom?: number
  /** Spherical harmonic bands for view-dependent colour, 0–3 (default: by gpuCapacity tier) */
  shBands?: number
  /** Skip splats whose opacity × pixel area is below this (default: 0, off) */
  minContribution?: number

  // --- Pass 1: ideal quality by 3D distance ---
  maxQualityDistance?: number
  falloffDistance?: number
  falloffStrength?: number
  floorLevel?: number

  // --- Pass 2: budget allocation via shrinking NDC circle ---
  coveragePasses?: number
  ndcRadiusFalloff?: number

  // --- Worker pool size (default: auto based on CPU cores) ---
  workerPoolSize?: number
}

// Band 3 SH costs 64 bytes per resident splat and band 1 costs 16, so the
// device tier from the GPU probe picks what the scene can afford
const shBandsForCapacity = (gpuCapacity = 0): number => {
  if (gpuCapacity >= 10_000_000) return 3
  if (gpuCapacity >= 5_000_000) return 1
  return 0
}

export class VolumetricGaussianSplat extends Node3D {
  protected _config: VolumetricGaussianSplatConfig

  private _manifest!: GridManifest
  private _cellIndex: Map<string, GridCell> = new Map()
  private _spatialIndex: Map<number, GridCell> = new Map()

  private _cells: Map<string, VGSCell> = new Map()

  private _fetchQueue: CellFetchRequest[] = []
  private _activeLoads: Set<string> = new Set()

  private _url: string

  // Cached from manifest
  private _gridMin: [number, number, number] = [0, 0, 0]
  private _gridCells: [number, number, number] = [0, 0, 0]
  private _cellSize: number = 1
  private _fileExtension: string = "sog"
  private _numSlices: number = 5
  private _sliceBands: number[] = []

  // Splat budget clamped to what the GPU can actually hold
  private _effectiveBudget = Infinity
  // Splats shown regardless of budget: every loaded cell keeps s0 visible
  private _baseCost = 0

  // World matrix as Float32Array for worker transfer
  private _worldMatrixArray: Float32Array = new Float32Array(16)
  private _shBands: number

  // Reusable objects
  private _reusableBox = new THREE.Box3()
  private _reusableFrustum = new THREE.Frustum()
  private _reusableProjectionMatrix = new THREE.Matrix4()
  private _reusableMin = new THREE.Vector3()
  private _reusableMax = new THREE.Vector3()
  private _reusableCenter = new THREE.Vector3()
  private _reusableNDCScratch = new THREE.Vector3()
  private _nonEmptyRanges: Set<string> = new Set()

  // Camera velocity tracking
  private _lastCameraPos = new THREE.Vector3()
  private _lastCameraQuat = new THREE.Quaternion()
  private _cameraVelocity = new THREE.Vector3()
  private _cameraAngularVelocity = new THREE.Vector3() // euler delta per frame
  private _velocitySmoothing = 0.85 // exponential smoothing factor

  private static readonly MAX_CONCURRENT_LOADS = 256
  private static readonly MAX_STALENESS = 120

  // Stelligra renderer — single persistent GPU texture
  private _splatRenderer: SplatRenderer

  // Worker pool for off-thread slice processing
  private _processorPool: SliceProcessorPool
  private _lastFrameTime = 0

  private _fetcher = new OctantFetcher({
    maxConcurrent: 512,
    cache: {
      enabled: true,
      dbName: "vgs-cache",
      maxSizeMb: 2048,
    },
  })

  private _visualisationMesh: THREE.LineSegments | null = null

  constructor(config: VolumetricGaussianSplatConfig) {
    super({ ...config, name: config.name ?? "vgs" })
    this._config = config
    this._url = config.url
    this._shBands = Math.min(
      Math.max(config.shBands ?? shBandsForCapacity(config.gpuCapacity), 0),
      3,
    )

    // Build world matrix from config and store as Float32Array for workers
    const worldMatrix = new THREE.Matrix4()
    if (config.position || config.rotation || config.scale !== undefined) {
      worldMatrix.compose(
        config.position ?? new THREE.Vector3(),
        config.rotation instanceof THREE.Quaternion
          ? config.rotation
          : new THREE.Quaternion(),
        new THREE.Vector3(
          config.scale ?? 1,
          config.scale ?? 1,
          config.scale ?? 1,
        ),
      )
    }
    this._worldMatrixArray = new Float32Array(worldMatrix.elements)

    // Create renderer and reserve GPU budget upfront
    const sourceRotation =
      config.rotation instanceof THREE.Quaternion
        ? config.rotation
        : new THREE.Quaternion()
    this._splatRenderer = new SplatRenderer({
      minResidentSliceLevel: 0,
      sortFrustumCull: config.sortFrustumCull ?? false,
      shBands: this._shBands,
      minContribution: config.minContribution ?? 0,
      shRotation: new THREE.Matrix3()
        .setFromMatrix4(
          new THREE.Matrix4().makeRotationFromQuaternion(sourceRotation),
        )
        .transpose(),
    })
    Catalyst._.scene.add(this._splatRenderer)

    // Create worker pool — processes slices off main thread
    this._processorPool = new SliceProcessorPool(
      config.workerPoolSize ??
        Math.max(1, (navigator.hardwareConcurrency ?? 4) - 1),
    )

    this.parseManifest(this._url)
    debug(
      `VolumetricGaussianSplat initialised: ${config.url} ` +
        `(${this._processorPool.poolSize} workers, budget ${(
          config.splatBudget ?? 500_000
        ).toLocaleString()})`,
      "VGS",
    )
  }

  //=========================
  // Setup
  //=========================

  private async parseManifest(url: string): Promise<void> {
    const manifestUrl = `${url}/manifest.bin.json`
    let data: unknown
    try {
      const response = await Catalyst._.reQuester.fetch(manifestUrl)
      if (response.reQuesterStatus === "error") {
        debug(`Manifest not found at ${manifestUrl}`, "VGS")
        return
      }
      data = response.data
    } catch (err) {
      debug(`Failed to fetch manifest: ${err}`, "VGS")
      return
    }

    const manifest = validateGridManifest(data)
    if (!manifest) {
      debug(`Invalid grid manifest at ${manifestUrl}`, "VGS")
      return
    }

    this._manifest = manifest
    this._gridMin = manifest.scene.bounding_box.min
    this._gridCells = manifest.config.grid_cells
    this._cellSize = manifest.config.cell_size
    this._fileExtension = manifest.config.file_extension
    this._numSlices = manifest.config.slices

    // Refine GPU capacity now that we know the scene size
    const deviceCapacity = this._config.gpuCapacity ?? 500_000
    const gpuCapacity = Math.min(deviceCapacity, manifest.scene.total_splats)
    this._splatRenderer.reserveCapacity(gpuCapacity)
    debug(
      `GPU capacity: ${gpuCapacity.toLocaleString()} splats ` +
        `(device: ${deviceCapacity.toLocaleString()}, scene: ${manifest.scene.total_splats.toLocaleString()})`,
      "VGS",
    )

    parseGridManifest(manifest, this._cellIndex, this._spatialIndex)
    this.buildNonEmptyRanges()

    if (
      Array.isArray(manifest.config.slice_bands) &&
      manifest.config.slice_bands.length > 0
    ) {
      this._sliceBands = manifest.config.slice_bands
    } else {
      const width = manifest.config.slice_width ?? 1 / this._numSlices
      this._sliceBands = Array(this._numSlices).fill(width)
    }

    // Requesting more than the GPU can hold makes new slices evict ones that
    // are still wanted, so the budget is capped below capacity.
    const headroom = this._config.gpuBudgetHeadroom ?? 0.85
    this._effectiveBudget = Math.min(
      this._config.splatBudget ?? Infinity,
      Math.floor(gpuCapacity * headroom),
    )
    this._baseCost = 0
    this._cellIndex.forEach((cell) => (this._baseCost += this.sliceCost(cell, 0)))
    debug(
      `Effective budget: ${this._effectiveBudget.toLocaleString()} ` +
        `(base s0: ${this._baseCost.toLocaleString()})`,
      "VGS",
    )

    debug(
      `Manifest parsed: ${manifest.scene.total_splats.toLocaleString()} splats, ` +
        `${this._cellIndex.size} cells, cell size ${this._cellSize}u, ` +
        `${this._numSlices} slices [${this._sliceBands
          .map((b) => (b * 100).toFixed(0) + "%")
          .join(", ")}]`,
      "VGS",
    )
  }

  private buildNonEmptyRanges(): void {
    const gridSize = Math.max(...this._gridCells)
    // Find next power of 2 >= gridSize for clean octree levels
    let topSize = 1
    while (topSize < gridSize) topSize *= 2

    this._nonEmptyRanges.clear()

    this._cellIndex.forEach((cell) => {
      // Mark all ancestor ranges containing this cell at every octree level
      let size = cell.multiplier
      while (size <= topSize) {
        // Snap to size-aligned boundary
        const sx = Math.floor(cell.x / size) * size
        const sy = Math.floor(cell.y / size) * size
        const sz = Math.floor(cell.z / size) * size
        this._nonEmptyRanges.add(`${sx}_${sy}_${sz}_${size}`)
        size *= 2
      }
    })

    debug(`Built non-empty ranges: ${this._nonEmptyRanges.size} nodes`, "VGS")
  }

  private getOrCreateCell(gridCell: GridCell): VGSCell {
    let cell = this._cells.get(gridCell.id)
    if (!cell) {
      cell = new VGSCell({
        cell: gridCell,
        renderer: this._splatRenderer,
        processorPool: this._processorPool,
        gridMin: this._gridMin,
        cellSize: this._cellSize,
        worldMatrix: this._worldMatrixArray,
        shBands: this._shBands,
      })
      this._cells.set(gridCell.id, cell)
    }
    return cell
  }

  //=========================
  // Desired state
  //=========================

  public computeDesiredState(): Map<string, number> {
    const t0 = performance.now()
    if (!this._manifest) return new Map()

    const camera = Catalyst._.camera?.view
    if (!camera) return new Map()
    camera.updateMatrixWorld()

    // Update camera velocity — exponentially smoothed
    const currentPos = camera.position
    const rawVelocity = currentPos.clone().sub(this._lastCameraPos)
    this._cameraVelocity.lerp(rawVelocity, 1 - this._velocitySmoothing)
    this._lastCameraPos.copy(currentPos)

    // Angular velocity from quaternion delta
    const currentQuat = camera.quaternion
    const quatDelta = this._lastCameraQuat
      .clone()
      .invert()
      .multiply(currentQuat)
    const euler = new THREE.Euler().setFromQuaternion(quatDelta)
    const rawAngular = new THREE.Vector3(euler.x, euler.y, euler.z)
    this._cameraAngularVelocity.lerp(rawAngular, 1 - this._velocitySmoothing)
    this._lastCameraQuat.copy(currentQuat)

    this._reusableProjectionMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    )
    this._reusableFrustum.setFromProjectionMatrix(
      this._reusableProjectionMatrix,
    )

    const t1 = performance.now()

    const gridSize = Math.max(...this._gridCells)
    const candidateMap = new Map<
      string,
      {
        cell: GridCell
        distance: number
        ndcDistance: number
        offScreen: boolean
      }
    >()

    this.cullRange(
      0,
      gridSize,
      0,
      gridSize,
      0,
      gridSize,
      this._reusableFrustum.planes,
      camera.position,
      camera,
      candidateMap,
      false,
    )

    // Expanded frustum — off-screen prefetch
    if ((this._config.frustumExpansion ?? 1.0) > 1.0) {
      const smearedFrustum = this.buildFrustum(
        this._reusableFrustum,
        camera,
        this._config.frustumExpansion ?? 1.2,
      )
      this.cullRange(
        0,
        gridSize,
        0,
        gridSize,
        0,
        gridSize,
        smearedFrustum.planes,
        camera.position,
        camera,
        candidateMap,
        false,
      )
    }

    const t2 = performance.now()

    const candidates = Array.from(candidateMap.values())

    // Pass 1: ideal quality per cell based on 3D distance
    const minSliceSplats = this._config.minSliceSplats ?? 10
    const maxSlice = this._config.maxSlice ?? this._numSlices - 1
    const idealLevels = new Map<string, number>()

    for (const { cell, distance } of candidates) {
      if (cell.splatCount < minSliceSplats) continue
      const ideal = this.idealLevel(cell, distance, maxSlice)
      if (ideal > 0) idealLevels.set(cell.id, ideal)
    }

    const t3 = performance.now()

    // Pass 2: budget allocation via shrinking NDC circle
    candidates.sort((a, b) => a.ndcDistance - b.ndcDistance)

    // s0 of every loaded cell is always shown, so it comes off the top
    const budget = this._effectiveBudget - this._baseCost
    const coveragePasses = this._config.coveragePasses ?? this._numSlices
    const ndcRadiusFalloff = this._config.ndcRadiusFalloff ?? 0
    const frustumExpansion = this._config.frustumExpansion ?? 1.0
    const maxNDCRadius = 1.5 * frustumExpansion

    const desired = new Map<string, number>()
    let remaining = budget

    for (let pass = 0; pass < coveragePasses; pass++) {
      const ndcRadius = maxNDCRadius - pass * ndcRadiusFalloff

      for (const { cell, ndcDistance } of candidates) {
        if (ndcDistance > ndcRadius) continue

        const ideal = idealLevels.get(cell.id)
        if (!ideal) continue

        const current = desired.get(cell.id) ?? 0
        if (current >= ideal) continue

        const sliceCost = current === 0 ? 0 : this.sliceCost(cell, current)
        if (sliceCost > remaining) continue

        desired.set(cell.id, current + 1)
        remaining -= sliceCost
      }
    }

    // Final pass: spend remaining budget outward from centre
    {
      for (const { cell } of candidates) {

        const ideal = idealLevels.get(cell.id)
        if (!ideal) continue

        const current = desired.get(cell.id) ?? 0
        if (current >= ideal) continue

        let allocated = current
        while (allocated < ideal) {
          const sliceCost =
            allocated === 0 ? 0 : this.sliceCost(cell, allocated)
          if (sliceCost > remaining) break
          allocated++
          remaining -= sliceCost
        }
        if (allocated > current) desired.set(cell.id, allocated)
      }
    }

    const t4 = performance.now()

    if (__DEBUG__) {
      const levelCost = (cell: GridCell, level: number) => {
        let cost = 0
        for (let sl = 0; sl < level; sl++) cost += this.sliceCost(cell, sl)
        return cost
      }
      let theoreticalCost = 0
      idealLevels.forEach((level, id) => {
        const gridCell = this._cellIndex.get(id)
        if (gridCell) theoreticalCost += levelCost(gridCell, level)
      })
      let actualCost = 0
      desired.forEach((level, id) => {
        const gridCell = this._cellIndex.get(id)
        if (gridCell) actualCost += levelCost(gridCell, level)
      })
      const t5 = performance.now()

      debug(
        `Budget: theoretical=${theoreticalCost.toLocaleString()} ` +
          `actual=${actualCost.toLocaleString()} ` +
          `budget=${this._effectiveBudget.toLocaleString()} ` +
          `cells=${desired.size}/${idealLevels.size} ` +
          `pool=${this._processorPool.activeCount}active/${this._processorPool.queueLength}queued ` +
          `sort=${this._splatRenderer.lastSortMs.toFixed(1)}ms`,
        "VGS",
      )
      debug(
        `computeDesiredState: frustum=${(t1 - t0).toFixed(1)}ms ` +
          `cull=${(t2 - t1).toFixed(1)}ms ` +
          `pass1=${(t3 - t2).toFixed(1)}ms ` +
          `pass2=${(t4 - t3).toFixed(1)}ms ` +
          `total=${(t5 - t0).toFixed(1)}ms ` +
          `candidates=${candidates.length}`,
        "VGS",
      )
    }

    if (this._config.visualise) {
      this.buildVisualisationMesh(desired)
    }

    return desired
  }

  private buildFrustum(
    baseFrustum: THREE.Frustum,
    camera: THREE.PerspectiveCamera,
    expansion: number,
  ): THREE.Frustum {
    const expanded = new THREE.Frustum()

    // Base uniform expansion
    for (let i = 0; i < 6; i++) {
      expanded.planes[i].copy(baseFrustum.planes[i])
      expanded.planes[i].constant *= expansion
    }

    const linearSpeed = this._cameraVelocity.length()
    const angularSpeed = this._cameraAngularVelocity.length()
    const speed = linearSpeed + angularSpeed * 2

    if (speed > 0.001) {
      // Smear direction — look direction for rotations, move direction for translation
      const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(
        camera.quaternion,
      )
      const useLinear = linearSpeed > 0.01
      const angularWeight = Math.min(angularSpeed * 200, 1.0)

      let smearDir: THREE.Vector3
      if (useLinear) {
        smearDir = this._cameraVelocity
          .clone()
          .normalize()
          .lerp(lookDir, angularWeight)
          .normalize()
      } else {
        smearDir = lookDir.clone()
      }

      // Convert angular velocity to degrees per frame for intuitive scaling
      const degreesPerFrame = angularSpeed * (180 / Math.PI)
      const frameLookahead = this._config.frustumSmearFrames ?? 8
      const smearDegrees = degreesPerFrame * frameLookahead

      // Also account for linear speed contribution
      const linearSmear = Math.min(
        linearSpeed * (this._config.frustumSmearScale ?? 20),
        this._config.frustumSmear ?? 8.0,
      )
      const angularSmear =
        Math.tan(Math.min(smearDegrees * (Math.PI / 180), Math.PI / 3)) * 10

      const smearAmount = Math.min(
        Math.max(linearSmear, angularSmear),
        this._config.frustumSmear ?? 8.0,
      )

      debug(
        `Frustum smear: speed=${speed.toFixed(4)} ` +
          `linear=${linearSpeed.toFixed(4)} ` +
          `angular=${angularSpeed.toFixed(4)} ` +
          `degrees/frame=${degreesPerFrame.toFixed(2)} ` +
          `smearAmount=${smearAmount.toFixed(2)} ` +
          `dir=${smearDir.x.toFixed(2)},${smearDir.y.toFixed(
            2,
          )},${smearDir.z.toFixed(2)}`,
        "VGS",
      )

      // Push frustum planes outward in smear direction
      for (let i = 0; i < 6; i++) {
        const plane = expanded.planes[i]
        const dot = plane.normal.dot(smearDir)
        if (dot > 0) {
          plane.constant += dot * smearAmount
        }
      }
    }

    return expanded
  }

  private sliceCost(cell: GridCell, slice: number): number {
    if (cell.sliceCount === 1) return slice === 0 ? cell.splatCount : 0
    return Math.round(cell.splatCount * (this._sliceBands[slice] ?? 0))
  }

  private idealLevel(
    cell: GridCell,
    distance: number,
    maxSlice: number,
  ): number {
    const {
      maxQualityDistance = 2,
      falloffDistance = 12,
      falloffStrength = 1.5,
      floorLevel = 1,
    } = this._config

    const maxLevel = Math.min(cell.sliceCount, maxSlice + 1)
    if (distance <= maxQualityDistance) return maxLevel
    if (distance >= falloffDistance) return floorLevel

    const t =
      (distance - maxQualityDistance) / (falloffDistance - maxQualityDistance)
    const quality = 1 - Math.pow(t, falloffStrength)
    return Math.max(floorLevel, Math.ceil(quality * maxLevel))
  }

  private cullRange(
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    zMin: number,
    zMax: number,
    planes: THREE.Plane[],
    cameraPosition: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    map: Map<
      string,
      {
        cell: GridCell
        distance: number
        ndcDistance: number
        offScreen: boolean
      }
    >,
    offScreen: boolean,
    parentFullyContained = false,
  ): void {
    const rangeSize = xMax - xMin
    if (!this._nonEmptyRanges.has(`${xMin}_${yMin}_${zMin}_${rangeSize}`))
      return

    let fullyContained = parentFullyContained

    if (!parentFullyContained) {
      // Inline AABB
      const minWX = xMin * this._cellSize + this._gridMin[0]
      const minWY = yMin * this._cellSize + this._gridMin[1]
      const minWZ = zMin * this._cellSize + this._gridMin[2]
      const maxWX = xMax * this._cellSize + this._gridMin[0]
      const maxWY = yMax * this._cellSize + this._gridMin[1]
      const maxWZ = zMax * this._cellSize + this._gridMin[2]

      const result = frustumClassifyBox(
        planes,
        minWX,
        minWY,
        minWZ,
        maxWX,
        maxWY,
        maxWZ,
      )
      if (result === -1) return
      fullyContained = result === 1
    }

    const gridCell = this.getCellAt(xMin, yMin, zMin, rangeSize)
    if (gridCell && gridCell.splatCount > 0) {
      this.addCandidate(gridCell, cameraPosition, camera, map, offScreen)
      return
    }

    if (rangeSize === 1) return

    const half = rangeSize / 2
    const xMid = xMin + half
    const yMid = yMin + half
    const zMid = zMin + half

    for (const [x0, x1] of [
      [xMin, xMid],
      [xMid, xMax],
    ] as [number, number][]) {
      for (const [y0, y1] of [
        [yMin, yMid],
        [yMid, yMax],
      ] as [number, number][]) {
        for (const [z0, z1] of [
          [zMin, zMid],
          [zMid, zMax],
        ] as [number, number][]) {
          this.cullRange(
            x0,
            x1,
            y0,
            y1,
            z0,
            z1,
            planes,
            cameraPosition,
            camera,
            map,
            offScreen,
            fullyContained,
          )
        }
      }
    }
  }

  private addCandidate(
    gridCell: GridCell,
    cameraPosition: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
    map: Map<
      string,
      {
        cell: GridCell
        distance: number
        ndcDistance: number
        offScreen: boolean
      }
    >,
    offScreen: boolean,
  ): void {
    if (map.has(gridCell.id)) return

    getCellBoundsInto(
      gridCell.x,
      gridCell.y,
      gridCell.z,
      gridCell.multiplier,
      this._gridMin,
      this._cellSize,
      this._reusableMin,
      this._reusableMax,
    )
    this._reusableBox.set(this._reusableMin, this._reusableMax)
    this._reusableBox.clampPoint(cameraPosition, this._reusableCenter)
    const distance = cameraPosition.distanceTo(this._reusableCenter)
    const ndcDistance = getCellNDCDistance(
      gridCell.x,
      gridCell.y,
      gridCell.z,
      gridCell.multiplier,
      this._gridMin,
      this._cellSize,
      camera,
      this._reusableNDCScratch,
    )
    map.set(gridCell.id, { cell: gridCell, distance, ndcDistance, offScreen })
  }

  private getCellAt(
    x: number,
    y: number,
    z: number,
    multiplier: number,
  ): GridCell | undefined {
    const key = x * 100000000 + y * 100000 + z * 100 + multiplier
    return this._spatialIndex.get(key)
  }

  //=========================
  // Reconcile
  //=========================

  public reconcile(desired: Map<string, number>): void {
    if (!this._manifest) return

    const camera = Catalyst._.camera?.view
    if (!camera) return

    const newDesired = new Map<string, number>()

    desired.forEach((targetSliceCount, id) => {
      const gridCell = this._cellIndex.get(id)
      if (!gridCell) return
      const cell = this.getOrCreateCell(gridCell)
      newDesired.set(id, targetSliceCount)
      cell.setDesiredLevel(targetSliceCount)
    })

    // Only hide cells that are no longer desired
    this._cells.forEach((cell, id) => {
      if (!newDesired.has(id) && cell.desiredLevel !== 1) {
        cell.setDesiredLevel(1)
      }
    })

    // Rebuild fetch queue
    const maxStaleness =
      this._config.maxStaleness ?? VolumetricGaussianSplat.MAX_STALENESS
    const existingRequests = new Map<string, CellFetchRequest>()
    for (const req of this._fetchQueue) {
      existingRequests.set(`${req.cellId}:${req.slice}`, req)
    }

    const newQueue: CellFetchRequest[] = []

    this._cells.forEach((cell, id) => {
      const neededSlice = cell.nextNeededSlice()
      if (neededSlice === null) return

      const key = `${id}:${neededSlice}`
      if (this._activeLoads.has(key)) return

      const isDesired = desired.has(id)
      const desiredLevel = desired.get(id) ?? -1

      getCellBoundsInto(
        cell.cell.x,
        cell.cell.y,
        cell.cell.z,
        cell.cell.multiplier,
        this._gridMin,
        this._cellSize,
        this._reusableMin,
        this._reusableMax,
      )
      this._reusableBox.set(this._reusableMin, this._reusableMax)
      this._reusableBox.clampPoint(camera.position, this._reusableCenter)
      const distance = camera.position.distanceTo(this._reusableCenter)
      const ndcDistance = getCellNDCDistance(
        cell.cell.x,
        cell.cell.y,
        cell.cell.z,
        cell.cell.multiplier,
        this._gridMin,
        this._cellSize,
        camera,
        this._reusableNDCScratch,
      )

      const existing = existingRequests.get(key)
      const staleness = isDesired ? 0 : (existing?.staleness ?? 0) + 1
      if (staleness > maxStaleness) return

      newQueue.push({
        cellId: id,
        slice: neededSlice,
        distance,
        ndcDistance,
        qualityGap: cell.qualityGap,
        isBaseSlice: neededSlice === 0,
        isDesired,
        desiredLevel,
        staleness,
      })
    })

    newQueue.sort((a, b) => {
      if (a.isDesired !== b.isDesired) return a.isDesired ? -1 : 1
      if (a.isDesired && b.isDesired) {
        if (a.isBaseSlice !== b.isBaseSlice) return a.isBaseSlice ? -1 : 1
        if (a.qualityGap !== b.qualityGap) return b.qualityGap - a.qualityGap
      }
      const scoreA = a.ndcDistance * 0.6 + (a.distance / 100) * 0.4
      const scoreB = b.ndcDistance * 0.6 + (b.distance / 100) * 0.4
      return scoreA - scoreB
    })

    this._fetchQueue = newQueue
    this.drainFetchQueue()

    if (this._config.visualise) {
      this.buildVisualisationMesh(desired)
    }
  }

  /**
   * Update Stelligra's SplatRenderer
   */
  public updateRenderer(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
  ): void {
    const now = performance.now()
    const frameTime = now - this._lastFrameTime
    this._lastFrameTime = now

    debug(
      `updateRenderer: frameTime=${frameTime.toFixed(1)}ms ` +
        `pendingUploads=${this._splatRenderer["_pendingUploads"]?.length ?? 0} ` +
        `aliveCount=${this._splatRenderer.splatCount}`,
      "VGS",
    )

    this._splatRenderer.update(camera, renderer)
  }

  //=========================
  // Fetching
  //=========================

  private drainFetchQueue(): void {
    debug(
      `Active loads: ${this._activeLoads.size}, queue: ${this._fetchQueue.length}`,
      "VGS",
    )
    while (
      this._fetchQueue.length > 0 &&
      this._activeLoads.size < VolumetricGaussianSplat.MAX_CONCURRENT_LOADS
    ) {
      const request = this._fetchQueue.shift()!
      this.fetchSlice(request)
    }
  }

  private async fetchSlice(request: CellFetchRequest): Promise<void> {
    const key = `${request.cellId}:${request.slice}`
    this._activeLoads.add(key)

    const gridCell = this._cellIndex.get(request.cellId)
    if (!gridCell) {
      this._activeLoads.delete(key)
      return
    }

    const url = getCellSlicePath(
      gridCell,
      request.slice,
      this._url,
      this._fileExtension,
    )

    const { promise } = this._fetcher.fetch(url, {
      depth: request.slice,
      distance: request.distance,
      priority: request.isBaseSlice ? 1 : 0,
    })

    try {
      const buffer = await promise
      const cell = this._cells.get(request.cellId)
      const renderer = Catalyst._.renderer
      if (cell && renderer) {
        // Pass renderer for GL calls after worker processing completes
        cell.injectSlice(request.slice, buffer, renderer)
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        debug(`Slice fetch aborted: ${key}`, "VGS")
      } else {
        debug(`Failed to load slice ${key}: ${err}`, "VGS")
      }
    } finally {
      this._activeLoads.delete(key)
      this.drainFetchQueue()
    }
  }

  //=========================
  // Bundle loading
  //=========================

  public loadPartition(buffer: ArrayBuffer, onComplete?: () => void): void {
    const renderer = Catalyst._.renderer
    if (!renderer) return

    const entries = parseVGSP(buffer)
    entries.forEach((sliceBuffer, key) => {
      const [cellId, sliceStr] = key.split(":")
      const slice = parseInt(sliceStr)
      const gridCell = this._cellIndex.get(cellId)
      if (!gridCell) return
      const cell = this.getOrCreateCell(gridCell)
      cell.injectSlice(slice, sliceBuffer, renderer)
    })
    debug(`Partition loaded: ${entries.size} slices injected`, "VGS")
    onComplete?.()
  }

  //=========================
  // Debug visualisation
  //=========================

  private buildVisualisationMesh(desired: Map<string, number>): void {
    if (this._visualisationMesh) {
      Catalyst._.scene.remove(this._visualisationMesh)
      this._visualisationMesh.geometry.dispose()
      this._visualisationMesh = null
    }

    const positions: number[] = []
    const vertexColors: number[] = []

    desired.forEach((sliceCount, id) => {
      const cell = this._cells.get(id)
      if (!cell) return

      const bounds = cell.getBounds()
      const min = bounds.min
      const max = bounds.max
      const t = sliceCount / this._numSlices
      const color = new THREE.Color().setHSL(t * 0.33, 1, 0.5)

      const corners = [
        [min.x, min.y, min.z],
        [max.x, min.y, min.z],
        [max.x, max.y, min.z],
        [min.x, max.y, min.z],
        [min.x, min.y, max.z],
        [max.x, min.y, max.z],
        [max.x, max.y, max.z],
        [min.x, max.y, max.z],
      ]
      const edges = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ]
      for (const [a, b] of edges) {
        positions.push(...corners[a], ...corners[b])
        vertexColors.push(color.r, color.g, color.b, color.r, color.g, color.b)
      }
    })

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    )
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(vertexColors, 3),
    )
    this._visualisationMesh = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
      }),
    )
    Catalyst._.scene.add(this._visualisationMesh)
  }

  //=========================
  // Stats & lifecycle
  //=========================

  public hideAll(): void {
    this._cells.forEach((cell) => cell.setDesiredLevel(-1))
    this._fetchQueue = []
    debug(`hideAll: ${this._cells.size} cells hidden`, "VGS")
  }

  public get splatRenderer(): SplatRenderer {
    return this._splatRenderer
  }

  /** True while slices are queued, fetching or being decoded. */
  public get isStreaming(): boolean {
    return (
      this._fetchQueue.length > 0 ||
      this._activeLoads.size > 0 ||
      this._processorPool.activeCount > 0 ||
      this._processorPool.queueLength > 0
    )
  }

  public inspect(): object {
    const cells: object[] = []
    let totalSplatsShown = 0

    this._cells.forEach((cell) => {
      const stats = cell.getStats()
      totalSplatsShown += stats.totalSplatsShown
      if (stats.desiredLevel !== -1 || stats.loadedSlices > 0) {
        cells.push(stats)
      }
    })

    return {
      totalCells: this._cells.size,
      activeCells: cells.length,
      totalSplatsShown,
      budget: this._effectiveBudget,
      baseCost: this._baseCost,
      lastSortMs: this._splatRenderer.lastSortMs,
      rendererSplatCount: this._splatRenderer.splatCount,
      workerPool: {
        size: this._processorPool.poolSize,
        active: this._processorPool.activeCount,
        queued: this._processorPool.queueLength,
      },
      activeLoads: this._activeLoads.size,
      fetchQueueSize: this._fetchQueue.length,
      sliceBands: this._sliceBands,
      cells,
    }
  }

  public getMemoryStats(): object {
    let totalLoaded = 0
    let totalVisible = 0
    let totalGap = 0

    this._cells.forEach((cell) => {
      const stats = cell.getStats()
      totalLoaded += stats.loadedSlices
      totalVisible += stats.displayedLevel
      totalGap += stats.qualityGap
    })

    return {
      cells: this._cells.size,
      totalLoaded,
      totalVisible,
      totalQualityGap: totalGap,
      rendererSplatCount: this._splatRenderer.splatCount,
      activeLoads: this._activeLoads.size,
      fetchQueueSize: this._fetchQueue.length,
    }
  }

  protected override onDispose(): void {
    this._fetcher.cancelAll()
    this._cells.forEach((cell) => cell.dispose())
    this._cells.clear()
    this._fetchQueue = []
    this._activeLoads.clear()

    this._processorPool.dispose()

    Catalyst._.scene.remove(this._splatRenderer)
    this._splatRenderer.dispose()

    if (this._visualisationMesh) {
      Catalyst._.scene.remove(this._visualisationMesh)
      this._visualisationMesh.geometry.dispose()
      this._visualisationMesh = null
    }

    debug(`VolumetricGaussianSplat disposed: ${this._url}`, "VGS")
  }
}
