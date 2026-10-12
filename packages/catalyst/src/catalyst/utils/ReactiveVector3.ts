import * as THREE from "three"

export function createReactiveVector3(
  onChanged: (vec: THREE.Vector3) => void
): THREE.Vector3 {
  const vec = new THREE.Vector3()

  return new Proxy(vec, {
    set: (target: any, prop: string, value: any) => {
      if (prop === "x" || prop === "y" || prop === "z") {
        target[prop] = value
        onChanged(target)
        return true
      }
      target[prop] = value
      return true
    },
  }) as THREE.Vector3
}
