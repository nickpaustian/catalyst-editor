import type {
  PointCloud,
  PointAttribute,
  ChunkKey,
  Chunk,
  ChunkedPointCloud,
  SpatialIndexOptions,
} from "../../types"

function makeKey(level: number, x: number, y: number, z: number): ChunkKey {
  return `${level}:${x},${y},${z}`
}

function getAttribute(
  attributes: PointAttribute[],
  name: string,
): PointAttribute | undefined {
  return attributes.find((a) => a.name === name)
}

export class SpatialIndex {
  private baseCellSize: number
  private levels: number
  private decimationFactor: number

  constructor(options: SpatialIndexOptions) {
    this.baseCellSize = options.baseCellSize
    this.levels = options.levels ?? 3
    this.decimationFactor = options.decimationFactor ?? 4
  }

  build(pointCloud: PointCloud): ChunkedPointCloud {
    const posAttr = getAttribute(pointCloud.points, "position")
    if (!posAttr) {
      throw new Error("PointCloud missing position attribute")
    }

    const positions = posAttr.data as Float32Array
    const pointCount = pointCloud.metadata.pointCount
    const bounds = pointCloud.metadata.bounds
    const maxLevel = this.levels - 1

    // Auto-compute baseCellSize if "auto" sentinel (0) or if the provided
    // size would create degenerate single-chunk intermediate levels.
    // Target: level 0 root cells ~= scene extent, finest cells = root / 2^maxLevel
    const sceneExtent = Math.max(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    )
    // Finest cell size so that level 0 cells span ~1 scene extent
    const autoBaseCellSize = sceneExtent / Math.pow(2, maxLevel)
    const baseCellSize =
      this.baseCellSize > 0 &&
      this.baseCellSize * Math.pow(2, maxLevel) <= sceneExtent * 2
        ? this.baseCellSize
        : autoBaseCellSize

    // Step 1: Assign each point to a finest-level cell
    const cellMap = new Map<string, number[]>()

    for (let i = 0; i < pointCount; i++) {
      const idx = i * 3
      const x = positions[idx]
      const y = positions[idx + 1]
      const z = positions[idx + 2]

      const cx = Math.floor((x - bounds.min[0]) / baseCellSize)
      const cy = Math.floor((y - bounds.min[1]) / baseCellSize)
      const cz = Math.floor((z - bounds.min[2]) / baseCellSize)

      const key = `${cx},${cy},${cz}`
      let indices = cellMap.get(key)
      if (!indices) {
        indices = []
        cellMap.set(key, indices)
      }
      indices.push(i)
    }

    // Step 2: Build finest-level chunks
    const chunks = new Map<ChunkKey, Chunk>()

    for (const [cellKey, indices] of cellMap) {
      const [cx, cy, cz] = cellKey.split(",").map(Number)
      const chunkKey = makeKey(maxLevel, cx, cy, cz)

      const chunkPositions = new Float32Array(indices.length * 3)
      let cMinX = Infinity,
        cMinY = Infinity,
        cMinZ = Infinity
      let cMaxX = -Infinity,
        cMaxY = -Infinity,
        cMaxZ = -Infinity

      for (let j = 0; j < indices.length; j++) {
        const srcIdx = indices[j] * 3
        const dstIdx = j * 3
        const x = positions[srcIdx]
        const y = positions[srcIdx + 1]
        const z = positions[srcIdx + 2]

        chunkPositions[dstIdx] = x
        chunkPositions[dstIdx + 1] = y
        chunkPositions[dstIdx + 2] = z

        if (x < cMinX) cMinX = x
        if (y < cMinY) cMinY = y
        if (z < cMinZ) cMinZ = z
        if (x > cMaxX) cMaxX = x
        if (y > cMaxY) cMaxY = y
        if (z > cMaxZ) cMaxZ = z
      }

      chunks.set(chunkKey, {
        key: chunkKey,
        level: maxLevel,
        gridPosition: [cx, cy, cz],
        bounds: {
          min: [cMinX, cMinY, cMinZ],
          max: [cMaxX, cMaxY, cMaxZ],
        },
        pointCount: indices.length,
        attributes: [
          { name: "position", data: chunkPositions, componentSize: 3 },
        ],
        children: [],
      })
    }

    // Step 3: Build coarser levels by merging
    for (let level = maxLevel - 1; level >= 0; level--) {
      const childLevel = level + 1
      const childChunks = [...chunks.values()].filter(
        (c) => c.level === childLevel,
      )

      // Group children by their parent grid position
      const parentGroups = new Map<string, Chunk[]>()

      for (const child of childChunks) {
        const px = Math.floor(child.gridPosition[0] / 2)
        const py = Math.floor(child.gridPosition[1] / 2)
        const pz = Math.floor(child.gridPosition[2] / 2)
        const parentCellKey = `${px},${py},${pz}`

        let group = parentGroups.get(parentCellKey)
        if (!group) {
          group = []
          parentGroups.set(parentCellKey, group)
        }
        group.push(child)
      }

      // Create parent chunks
      for (const [cellKey, children] of parentGroups) {
        const [px, py, pz] = cellKey.split(",").map(Number)
        const parentKey = makeKey(level, px, py, pz)

        // Collect all child positions for decimation
        let totalChildPoints = 0
        for (const child of children) {
          totalChildPoints += child.pointCount
        }

        // Decimation: take every Nth point
        const targetCount = Math.max(
          1,
          Math.ceil(totalChildPoints / this.decimationFactor),
        )
        const parentPositions = new Float32Array(targetCount * 3)

        let pMinX = Infinity,
          pMinY = Infinity,
          pMinZ = Infinity
        let pMaxX = -Infinity,
          pMaxY = -Infinity,
          pMaxZ = -Infinity

        // Gather all positions from children then sample
        let written = 0
        let globalIdx = 0
        const step = Math.max(1, Math.floor(totalChildPoints / targetCount))

        for (const child of children) {
          const childPos = getAttribute(child.attributes, "position")!
            .data as Float32Array
          for (let j = 0; j < child.pointCount; j++) {
            if (globalIdx % step === 0 && written < targetCount) {
              const srcIdx = j * 3
              const dstIdx = written * 3
              const x = childPos[srcIdx]
              const y = childPos[srcIdx + 1]
              const z = childPos[srcIdx + 2]

              parentPositions[dstIdx] = x
              parentPositions[dstIdx + 1] = y
              parentPositions[dstIdx + 2] = z

              if (x < pMinX) pMinX = x
              if (y < pMinY) pMinY = y
              if (z < pMinZ) pMinZ = z
              if (x > pMaxX) pMaxX = x
              if (y > pMaxY) pMaxY = y
              if (z > pMaxZ) pMaxZ = z

              written++
            }
            globalIdx++
          }
        }

        // Trim if we wrote fewer than allocated
        const finalPositions =
          written < targetCount
            ? parentPositions.slice(0, written * 3)
            : parentPositions

        const childKeys = children.map((c) => c.key)

        chunks.set(parentKey, {
          key: parentKey,
          level,
          gridPosition: [px, py, pz],
          bounds: {
            min: [pMinX, pMinY, pMinZ],
            max: [pMaxX, pMaxY, pMaxZ],
          },
          pointCount: written,
          attributes: [
            { name: "position", data: finalPositions, componentSize: 3 },
          ],
          children: childKeys,
        })
      }
    }

    // Step 4: Identify root chunks (level 0)
    const rootChunks: ChunkKey[] = [...chunks.values()]
      .filter((c) => c.level === 0)
      .map((c) => c.key)

    return {
      chunks,
      rootChunks,
      metadata: {
        pointCount,
        bounds,
        baseCellSize,
        levels: this.levels,
        sourceFormat: pointCloud.metadata.sourceFormat,
        loadedAt: pointCloud.metadata.loadedAt,
      },
    }
  }
}
