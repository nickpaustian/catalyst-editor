import type { PointAttribute } from "./PointCloud"

export type ChunkKey = `${number}:${number},${number},${number}`

export interface Chunk {
  key: ChunkKey
  level: number
  gridPosition: [number, number, number]
  bounds: {
    min: [number, number, number]
    max: [number, number, number]
  }
  pointCount: number
  attributes: PointAttribute[]
  children: ChunkKey[]
}

export interface ChunkedPointCloud {
  chunks: Map<ChunkKey, Chunk>
  rootChunks: ChunkKey[]
  metadata: {
    pointCount: number
    bounds: {
      min: [number, number, number]
      max: [number, number, number]
    }
    baseCellSize: number
    levels: number
    sourceFormat: string
    loadedAt: number
  }
}

export interface SpatialIndexOptions {
  baseCellSize: number
  levels?: number
  decimationFactor?: number
}
