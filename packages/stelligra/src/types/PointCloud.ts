export interface PointAttribute {
  name: string
  data: Float32Array | Uint8Array | Uint16Array
  componentSize: number // 1 for scalar, 3 for vec3, 4 for vec4, etc.
  normalised?: boolean // for unsigned int colours
}

export interface PointCloud {
  points: PointAttribute[]
  metadata: {
    pointCount: number
    bounds: {
      min: [number, number, number]
      max: [number, number, number]
    }
    sourceFormat: string
    loadedAt: number
  }
}
