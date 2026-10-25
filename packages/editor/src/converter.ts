/** The maps' names as a person reads them. */
export const MAP_NAMES: Record<string, string> = { baseColour: "base colour", normal: "normal", metallicRoughness: "metallic-roughness", occlusion: "occlusion", orm: "occlusion-roughness-metallic" }

/** A mesh of a model file, as the converter describes it for choosing what to build. */
export interface StreamableMesh {
  index: number
  name: string | null
  triangles: number | null
  /** The material's maps that become tile pyramids: "baseColour", "normal", "metallicRoughness", "occlusion" or "orm". */
  maps: string[]
  /** What the streamed surface will not show of the mesh, or why it cannot be built. */
  warnings: string[]
  /** One primitive with UVs, which is what a cluster hierarchy is cut from. */
  buildable: boolean
}

export interface StreamableOptions {
  mesh: number
  /** Let simplification cross UV seams, for scans whose layout is many small islands. */
  permissive: boolean
  /** Group clusters with meshoptimizer's partitioner and keep triangles even as they simplify. */
  partition: boolean
  /** WebP quality of the tiles, 0 to 100. */
  quality: number
  /** The largest side a map is cut at. */
  maxTexture: number
  /** Image files to tile as maps over the model's own, by absolute path. */
  maps?: { role: string; path: string }[]
}

export interface StreamableProgress {
  stage: string
  step: number
  steps: number
  /** How far through the stage, 0 to 1, when that can be told. */
  fraction: number | null
  message: string
}

/** What a build wrote, with folders relative to its output folder. */
export interface StreamableResult {
  clusters: string
  tiles: string | null
  maps: { role: string; folder: string; size: number }[]
  triangles: number
  warnings: string[]
}

export interface StreamableJob {
  result: Promise<StreamableResult>
  cancel(): void
}

/** Turns a project's model files into streamable assets: a cluster hierarchy and tile pyramids. The desktop app runs Iapetus for it. Paths are absolute. */
export interface AssetConverter {
  describe(path: string): Promise<StreamableMesh[]>
  makeStreamable(input: string, out: string, options: StreamableOptions, progress: (progress: StreamableProgress) => void): StreamableJob
}
