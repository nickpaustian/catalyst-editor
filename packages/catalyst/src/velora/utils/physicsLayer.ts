export type PhysicsLayer = number // 0-31

/**
 * Convert layer(s) to bitmask.
 */
export function layersToBitmask(layers: PhysicsLayer[]): number {
  return layers.reduce((mask, layer) => {
    if (layer < 0 || layer > 31) {
      throw new Error(`PhysicsLayer must be 0-31, got ${layer}`)
    }
    return mask | (1 << layer)
  }, 0)
}

/**
 * Check if a layer is in a bitmask.
 */
export function isLayerInMask(layer: PhysicsLayer, mask: number): boolean {
  if (layer < 0 || layer > 31) {
    throw new Error(`PhysicsLayer must be 0-31, got ${layer}`)
  }
  return (mask & (1 << layer)) !== 0
}

/**
 * Create a bitmask from individual layers.
 */
export function createLayerMask(...layers: PhysicsLayer[]): number {
  return layersToBitmask(layers)
}
