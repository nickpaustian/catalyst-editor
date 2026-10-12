import * as THREE from "three"

const TEX_WIDTH = 2048

const VERTEX_SHADER = /* glsl */ `
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform highp sampler2D u_centerTex;
uniform highp sampler2D u_colorTex;
uniform highp mat4 u_mv;
uniform highp mat4 u_mvp;
uniform float u_near;
uniform int u_count;
uniform int u_texWidth;

out vec4 outColor;

// Little-endian byte packing: the returned Uint8Array, when viewed as a
// Uint32Array, recovers the original uint32 without any conversion loop.
vec4 packLE(uint bits) {
  return vec4(
    float(bits & 255u),
    float((bits >> 8u) & 255u),
    float((bits >> 16u) & 255u),
    float((bits >> 24u) & 255u)
  ) / 255.0;
}

void main() {
  int slot = int(gl_FragCoord.y) * u_texWidth + int(gl_FragCoord.x);
  if (slot >= u_count) { outColor = packLE(0u); return; }

  int tx = slot % u_texWidth;
  int ty = slot / u_texWidth;

  // Dead: alpha == 0 means slot was freed via zeroColorAlpha()
  if (texelFetch(u_colorTex, ivec2(tx, ty), 0).a < (0.5 / 255.0)) {
    outColor = packLE(0u);
    return;
  }

  vec3 pos = texelFetch(u_centerTex, ivec2(tx, ty), 0).xyz;

  // View-space depth (positive = in front of camera)
  float w = -(u_mv * vec4(pos, 1.0)).z;
  if (w < u_near) { outColor = packLE(0u); return; }

  // Frustum cull with 1.2x margin
  vec4 clip = u_mvp * vec4(pos, 1.0);
  float margin = 1.2 * clip.w;
  if (clip.x < -margin || clip.x > margin || clip.y < -margin || clip.y > margin) {
    outColor = packLE(0u);
    return;
  }

  outColor = packLE(floatBitsToUint(w));
}
`

// Augment WebGLRenderer with the async readback signature from Three.js r166+.
// The function takes a pre-allocated buffer as the 6th argument (fills it in
// place via PBO and returns it) — calling without the buffer throws.
type WebGLRendererWithAsync = THREE.WebGLRenderer & {
  readRenderTargetPixelsAsync(
    renderTarget: THREE.WebGLRenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    buffer: Uint8Array,
  ): Promise<Uint8Array>
}

/**
 * GPU sort-key pass with async PBO readback.
 *
 * Renders a full-screen pass reading from SplatMaterial's existing center and
 * colour textures, outputting one packed uint32 depth key per splat slot into
 * an RGBA8 render target.  The result is transferred to the sort worker as a
 * Uint32Array via transferable zero-copy.
 *
 * Key encoding:
 *   visible slot → floatBitsToUint(view-space depth w)
 *   dead / culled → 0   (sort worker excludes key == 0)
 *
 * Back-to-front order: ascending sort by ~key (inverted bits); far splats
 * (large depth → small inverted key) sort first.
 *
 * The render-target state is restored to `prevRt` synchronously *before*
 * the internal fence await so that the main scene always renders to the
 * correct target regardless of readback timing.
 */
export class SortKeyPass {
  private _rt: THREE.WebGLRenderTarget
  private _rtWidth = 0
  private _rtHeight = 0
  // Persistent readback buffer: Three.js r182 readRenderTargetPixelsAsync
  // requires a caller-supplied buffer as the 6th argument.
  private _readbackBuf = new Uint8Array(0)

  private _scene: THREE.Scene
  private _camera: THREE.OrthographicCamera
  private _mesh: THREE.Mesh
  private _mat: THREE.RawShaderMaterial

  constructor() {
    this._rt = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    })

    const geo = new THREE.BufferGeometry()
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
        3,
      ),
    )

    this._mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        u_centerTex: { value: null },
        u_colorTex:  { value: null },
        u_mv:        { value: new THREE.Matrix4() },
        u_mvp:       { value: new THREE.Matrix4() },
        u_near:      { value: 0.1 },
        u_count:     { value: 0 },
        u_texWidth:  { value: TEX_WIDTH },
      },
      depthTest: false,
      depthWrite: false,
    })

    this._mesh = new THREE.Mesh(geo, this._mat)
    this._mesh.frustumCulled = false
    this._scene = new THREE.Scene()
    this._scene.add(this._mesh)
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  }

  /**
   * Render the key pass and asynchronously read back the results.
   *
   * The render-to-texture happens synchronously (GPU commands queued).
   * The async fence wait (PBO readback) is started immediately after, and the
   * render target is restored to `prevRt` *before* the first await so the
   * main scene always renders to the correct target.
   *
   * `reclaimedBuf` is the keys ArrayBuffer returned by the sort worker on the
   * previous frame — reused as the output buffer to avoid per-frame allocation.
   */
  async computeKeys(
    renderer: THREE.WebGLRenderer,
    centerTex: THREE.DataTexture,
    colorTex: THREE.DataTexture,
    mv: THREE.Matrix4,
    mvp: THREE.Matrix4,
    near: number,
    count: number,
    reclaimedBuf: ArrayBuffer | null,
  ): Promise<Uint32Array> {
    const width = TEX_WIDTH
    const height = Math.ceil(count / width)

    if (width !== this._rtWidth || height !== this._rtHeight) {
      this._rt.setSize(width, height)
      this._rtWidth = width
      this._rtHeight = height
    }

    this._mat.uniforms.u_centerTex.value = centerTex
    this._mat.uniforms.u_colorTex.value  = colorTex
    this._mat.uniforms.u_mv.value.copy(mv)
    this._mat.uniforms.u_mvp.value.copy(mvp)
    this._mat.uniforms.u_near.value    = near
    this._mat.uniforms.u_count.value   = count
    this._mat.uniformsNeedUpdate = true

    const prevRt = renderer.getRenderTarget()

    renderer.setRenderTarget(this._rt)
    renderer.render(this._scene, this._camera)

    // Grow the readback buffer lazily.
    const pixelBytes = width * height * 4
    if (this._readbackBuf.length < pixelBytes) {
      this._readbackBuf = new Uint8Array(pixelBytes)
    }

    // Kick off the async PBO readback *before* restoring the render target.
    // gl.readPixels into the PBO is issued synchronously here; the promise
    // only awaits the GPU fence (non-blocking).
    const readbackPromise = (renderer as WebGLRendererWithAsync)
      .readRenderTargetPixelsAsync(this._rt, 0, 0, width, height, this._readbackBuf)

    // Restore render target immediately so the main-scene render that fires
    // while we await the fence writes to the correct target (screen / prevRt).
    renderer.setRenderTarget(prevRt)

    await readbackPromise

    // Build output Uint32Array in reclaimed or fresh buffer.
    let outBuf: ArrayBuffer
    if (reclaimedBuf && reclaimedBuf.byteLength >= count * 4) {
      outBuf = reclaimedBuf
    } else {
      outBuf = new ArrayBuffer(count * 4)
    }

    const keys = new Uint32Array(outBuf, 0, count)
    // Little-endian packing in the shader means the RGBA bytes map directly
    // onto uint32 values — copy bytes straight in without any conversion.
    new Uint8Array(keys.buffer, 0, count * 4).set(
      this._readbackBuf.subarray(0, count * 4),
    )
    return keys
  }

  dispose(): void {
    this._rt.dispose()
    this._mat.dispose()
    this._mesh.geometry.dispose()
  }
}
