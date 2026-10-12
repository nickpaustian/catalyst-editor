import * as THREE from "three"

export const stripRoll = (quat: THREE.Quaternion): THREE.Quaternion => {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat)
  const up = new THREE.Vector3(0, 1, 0)
  const mat = new THREE.Matrix4().lookAt(
    new THREE.Vector3(0, 0, 0),
    forward,
    up
  )
  return new THREE.Quaternion().setFromRotationMatrix(mat)
}
