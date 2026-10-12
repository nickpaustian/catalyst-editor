export interface SplatOptions {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
  progressiveLoad?: boolean
  sphericalHarmonicsDegree?: number
  onReady?: () => void
  onError?: (error) => void
  renderFunc?: () => void
  maxRetries?: number
  retryDelay?: number
}
