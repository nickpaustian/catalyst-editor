import * as THREE from "three"

/**
 * Build the instanced quad geometry used to render Gaussian splats.
 *
 * Each instance of the unit quad [-1,1]² represents one splat.
 * The instanced `splatIndex` attribute tells the vertex shader which
 * splat's data to look up in the GPU textures.
 *
 * @param maxSplatCount Upper bound on the number of splats this geometry
 *                      will need to render. The `splatIndex` buffer is
 *                      allocated to this size; use `setRenderCount` to
 *                      control how many are actually drawn each frame.
 */
export function buildSplatGeometry(
  maxSplatCount: number,
): THREE.InstancedBufferGeometry {
  const base = new THREE.BufferGeometry()
  base.setIndex([0, 1, 2, 0, 2, 3])

  const pos = new Float32Array([
    -1, -1, 0,
    -1,  1, 0,
     1,  1, 0,
     1, -1, 0,
  ])
  base.setAttribute("position", new THREE.BufferAttribute(pos, 3))

  const geom = new THREE.InstancedBufferGeometry()
  geom.setIndex(base.index)
  geom.setAttribute("position", base.attributes.position)

  const indices = new Uint32Array(maxSplatCount)
  for (let i = 0; i < maxSplatCount; i++) indices[i] = i
  const splatIndex = new THREE.InstancedBufferAttribute(indices, 1, false)
  splatIndex.setUsage(THREE.DynamicDrawUsage)
  geom.setAttribute("splatIndex", splatIndex)

  geom.instanceCount = 0

  return geom
}
