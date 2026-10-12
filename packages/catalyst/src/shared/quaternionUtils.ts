import * as THREE from "three"

export const extractAxisRotation = (
  sourceQuaternion: THREE.Quaternion,
  axis: "X" | "Y" | "Z"
): THREE.Quaternion => {
  const euler = new THREE.Euler().setFromQuaternion(sourceQuaternion, "YXZ")

  if (axis !== "X") euler.x = 0
  if (axis !== "Y") euler.y = 0
  if (axis !== "Z") euler.z = 0

  return new THREE.Quaternion().setFromEuler(euler)
}
