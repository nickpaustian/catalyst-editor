import * as THREE from "three"
import { Catalyst } from "../core/Catalyst"

export interface ScreenSpaceData {
  screenPosition: THREE.Vector2
  distance: number
  isOnScreen: boolean
}

/**
 * Convert a world position to screen space coordinates with distance info.
 * Returns null if point is behind camera.
 */
export function worldToScreenSpace(
  worldPosition: THREE.Vector3,
  camera: THREE.Camera | undefined = Catalyst._.camera?.view
): ScreenSpaceData | null {
  if (!camera) return null
  const vector = worldPosition.clone()

  // Calculate distance from camera
  const distance = camera.position.distanceTo(worldPosition)

  // Project world position to NDC (normalised device coordinates)
  vector.project(camera)

  // Check if behind camera
  if (vector.z > 1) {
    return null
  }

  // Convert NDC to screen space
  const width = window.innerWidth
  const height = window.innerHeight

  const screenX = (vector.x * width) / 2 + width / 2
  const screenY = -(vector.y * height) / 2 + height / 2

  const isOnScreen =
    screenX >= 0 && screenX <= width && screenY >= 0 && screenY <= height

  return {
    screenPosition: new THREE.Vector2(screenX, screenY),
    distance,
    isOnScreen,
  }
}

/**
 * Check if a world position is visible to the camera (not behind).
 */
export function isPositionVisible(
  worldPosition: THREE.Vector3,
  camera: THREE.Camera | undefined = Catalyst._.camera?.view
): boolean {
  if (!camera) return false
  const vector = worldPosition.clone()
  vector.project(camera)
  return vector.z <= 1
}
