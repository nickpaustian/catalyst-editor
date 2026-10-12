import * as THREE from "three"
import type { Collider } from "../colliders/Collider"

export interface OBB {
  center: THREE.Vector3
  halfExtents: THREE.Vector3
  axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3]
}

export interface SATResult {
  colliding: boolean
  normal: THREE.Vector3
  depth: number
}

export function obbFromCollider(collider: Collider): OBB {
  const localBox = collider.localBoundingBox
  const halfExtents = new THREE.Vector3()
  localBox.getSize(halfExtents).multiplyScalar(0.5)

  const localCenter = new THREE.Vector3()
  localBox.getCenter(localCenter)
  localCenter.applyQuaternion(collider.rotation)

  const axisX = new THREE.Vector3(1, 0, 0).applyQuaternion(collider.rotation)
  const axisY = new THREE.Vector3(0, 1, 0).applyQuaternion(collider.rotation)
  const axisZ = new THREE.Vector3(0, 0, 1).applyQuaternion(collider.rotation)

  return {
    center: collider.position.clone().add(localCenter),
    halfExtents,
    axes: [axisX, axisY, axisZ],
  }
}

export function testOBBvsOBB(a: OBB, b: OBB): SATResult {
  const noCollision: SATResult = {
    colliding: false,
    normal: new THREE.Vector3(),
    depth: 0,
  }

  let minOverlap = Infinity
  let minAxis = new THREE.Vector3()

  const toCenter = new THREE.Vector3().subVectors(b.center, a.center)

  // Build all 15 test axes
  const axes: THREE.Vector3[] = []

  // 3 from A, 3 from B
  axes.push(...a.axes, ...b.axes)

  // 9 cross products
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const cross = new THREE.Vector3().crossVectors(a.axes[i], b.axes[j])
      axes.push(cross)
    }
  }

  for (const axis of axes) {
    // Skip near-zero axes (parallel edges produce degenerate cross products)
    const length = axis.length()
    if (length < 0.0001) continue
    axis.normalize()

    // Project both OBBs onto this axis
    const projA =
      Math.abs(a.halfExtents.x * a.axes[0].dot(axis)) +
      Math.abs(a.halfExtents.y * a.axes[1].dot(axis)) +
      Math.abs(a.halfExtents.z * a.axes[2].dot(axis))

    const projB =
      Math.abs(b.halfExtents.x * b.axes[0].dot(axis)) +
      Math.abs(b.halfExtents.y * b.axes[1].dot(axis)) +
      Math.abs(b.halfExtents.z * b.axes[2].dot(axis))

    const distance = Math.abs(toCenter.dot(axis))
    const overlap = projA + projB - distance

    if (overlap <= 0) return noCollision

    if (overlap < minOverlap) {
      minOverlap = overlap
      minAxis = axis.clone()
    }
  }

  // Ensure normal points from A to B
  if (toCenter.dot(minAxis) < 0) {
    minAxis.negate()
  }

  return {
    colliding: true,
    normal: minAxis,
    depth: minOverlap,
  }
}

export function binarySearchCollisionPointOBB(
  obb: OBB,
  movement: THREE.Vector3,
  otherOBB: OBB,
  iterations: number = 1000,
  minIterationChange: number = 0.0001
): number {
  let low = 0
  let high = 1
  let previousMid = -1

  for (let i = 0; i < iterations; i++) {
    const mid = (low + high) / 2

    if (Math.abs(mid - previousMid) < minIterationChange) {
      return low
    }
    previousMid = mid

    const testOBB: OBB = {
      ...obb,
      center: obb.center.clone().add(movement.clone().multiplyScalar(mid)),
    }

    const result = testOBBvsOBB(testOBB, otherOBB)

    if (result.colliding) {
      high = mid
    } else {
      low = mid
    }
  }

  return low
}

export function calculateBoxOverlap(
  box1: THREE.Box3,
  box2: THREE.Box3
): { x: number; y: number; z: number } {
  return {
    x: Math.min(box1.max.x, box2.max.x) - Math.max(box1.min.x, box2.min.x),
    y: Math.min(box1.max.y, box2.max.y) - Math.max(box1.min.y, box2.min.y),
    z: Math.min(box1.max.z, box2.max.z) - Math.max(box1.min.z, box2.min.z),
  }
}

export function calculateSweptBoxOverlap(
  box: THREE.Box3,
  movement: THREE.Vector3,
  otherBox: THREE.Box3
): { x: number; y: number; z: number } {
  const sweptBox = box.clone()
  const endBox = box.clone().translate(movement)
  sweptBox.union(endBox)

  return calculateBoxOverlap(sweptBox, otherBox)
}

export function getSmallestOverlapAxis(overlap: {
  x: number
  y: number
  z: number
}): "X" | "Y" | "Z" {
  if (overlap.x <= overlap.y && overlap.x <= overlap.z) {
    return "X"
  } else if (overlap.y <= overlap.x && overlap.y <= overlap.z) {
    return "Y"
  } else {
    return "Z"
  }
}

let shouldLog = false

document.addEventListener("keydown", (e) => {
  if (e.key === "l") {
    shouldLog = true
  }
})

export function binarySearchCollisionPoint(
  box: THREE.Box3,
  movement: THREE.Vector3,
  otherBox: THREE.Box3,
  iterations: number = 1000,
  minIterationChange: number = 0.0001
): number {
  let low = 0
  let high = 1
  let previousMid = -1

  for (let i = 0; i < iterations; i++) {
    const mid = (low + high) / 2

    // Exit if the mid point stopped changing significantly
    if (Math.abs(mid - previousMid) < minIterationChange) {
      if (shouldLog) {
        console.log(
          `Converged at iteration ${i}: mid change ${Math.abs(
            mid - previousMid
          ).toFixed(10)} < ${minIterationChange}`
        )
      }
      shouldLog = false
      return low
    }
    previousMid = mid

    const testMovement = movement.clone().multiplyScalar(mid)
    const sweptOverlap = calculateSweptBoxOverlap(box, testMovement, otherBox)
    const isColliding =
      sweptOverlap.x > 0 && sweptOverlap.y > 0 && sweptOverlap.z > 0

    if (shouldLog) {
      const safeDistance = mid * movement.length()
      console.log(
        `Iteration ${i}: mid=${mid.toFixed(6)}, distance=${safeDistance.toFixed(
          4
        )}, colliding:`,
        isColliding
      )
    }

    if (isColliding) {
      high = mid
    } else {
      low = mid
    }
  }

  shouldLog = false
  return low
}
