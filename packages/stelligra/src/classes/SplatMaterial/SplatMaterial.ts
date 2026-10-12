import * as THREE from "three"
import { RawTexture, RAW_TEX_WIDTH } from "./RawTexture"
import { COV_SCALE, UINTS_PER_SPLAT } from "./packing"

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

/**
 * Vertex shader for 3D Gaussian splatting.
 *
 * Splat data lives in one RGBA32UI texture, 2 texels per splat — see
 * packing.ts for the layout. Texture width is even, so both texels of a
 * splat always share a row.
 *
 * View-dependent colour (SH_BANDS > 0) reads u_shTex, SH_TEXELS texels per
 * splat: a float scale, then one 11/10/11 word per RGB coefficient (see
 * stelligra-wasm pack_sh). Coefficients stay in the source frame, so the view
 * direction is rotated back by u_shRotation.
 */
const VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;
precision highp usampler2D;

attribute uint splatIndex;

uniform usampler2D u_splatTex;
uniform int        u_texWidth;
uniform vec2       u_viewport;
uniform vec2       u_focal;
uniform float      u_splatScale;
uniform float      u_minContribution;

#if SH_BANDS > 0
uniform usampler2D u_shTex;
uniform int        u_shTexWidth;
uniform mat3       u_shRotation;

vec3 unpackSH(uint word) {
    vec3 v = vec3(uvec3(word >> 21u, word >> 11u, word) & uvec3(0x7ffu, 0x3ffu, 0x7ffu));
    return v / vec3(2047.0, 1023.0, 2047.0) * 2.0 - 1.0;
}

vec3 evaluateSH(int splat, vec3 dir) {
    int   texel = splat * SH_TEXELS;
    ivec2 st    = ivec2(texel % u_shTexWidth, texel / u_shTexWidth);
    uvec4 s0    = texelFetch(u_shTex, st, 0);
    float x = dir.x, y = dir.y, z = dir.z;

    vec3 result = 0.4886025119029199 * (
        -unpackSH(s0.y) * y + unpackSH(s0.z) * z - unpackSH(s0.w) * x
    );

#if SH_BANDS > 1
    uvec4 s1 = texelFetch(u_shTex, st + ivec2(1, 0), 0);
    uvec4 s2 = texelFetch(u_shTex, st + ivec2(2, 0), 0);
    float xx = x * x, yy = y * y, zz = z * z;
    float xy = x * y, yz = y * z, xz = x * z;
    result += unpackSH(s1.x) * (1.0925484305920792 * xy)
        + unpackSH(s1.y) * (-1.0925484305920792 * yz)
        + unpackSH(s1.z) * (0.31539156525252005 * (2.0 * zz - xx - yy))
        + unpackSH(s1.w) * (-1.0925484305920792 * xz)
        + unpackSH(s2.x) * (0.5462742152960396 * (xx - yy));
#endif

#if SH_BANDS > 2
    uvec4 s3 = texelFetch(u_shTex, st + ivec2(3, 0), 0);
    result += unpackSH(s2.y) * (-0.5900435899266435 * y * (3.0 * xx - yy))
        + unpackSH(s2.z) * (2.890611442640554 * xy * z)
        + unpackSH(s2.w) * (-0.4570457994644658 * y * (4.0 * zz - xx - yy))
        + unpackSH(s3.x) * (0.3731763325901154 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy))
        + unpackSH(s3.y) * (-0.4570457994644658 * x * (4.0 * zz - xx - yy))
        + unpackSH(s3.z) * (1.445305721320277 * z * (xx - yy))
        + unpackSH(s3.w) * (-0.5900435899266435 * x * (xx - 3.0 * yy));
#endif

    return result * uintBitsToFloat(s0.x);
}
#endif

varying vec4 vColor;
varying vec2 vPosition;

void main() {
    int   texel = int(splatIndex) * 2;
    ivec2 tc    = ivec2(texel % u_texWidth, texel / u_texWidth);
    uvec4 t0    = texelFetch(u_splatTex, tc, 0);
    uvec4 t1    = texelFetch(u_splatTex, tc + ivec2(1, 0), 0);

    vec3 splatCenter = uintBitsToFloat(t0.xyz);
    vColor = vec4((uvec4(t0.w) >> uvec4(0u, 8u, 16u, 24u)) & 0xffu) / 255.0;
#if SH_BANDS > 0
    vec3 viewDir = u_shRotation * normalize(splatCenter - cameraPosition);
    vColor.rgb = clamp(vColor.rgb + evaluateSH(int(splatIndex), viewDir), 0.0, 1.0);
#endif

    vec4 viewPos = modelViewMatrix * vec4(splatCenter, 1.0);
    vec4 clipPos = projectionMatrix * viewPos;

    vec2 c0 = unpackHalf2x16(t1.x) * COV_INV_SCALE;
    vec2 c1 = unpackHalf2x16(t1.y) * COV_INV_SCALE;
    vec2 c2 = unpackHalf2x16(t1.z) * COV_INV_SCALE;

    mat3 Vrk = mat3(
        c0.x, c0.y, c1.x,
        c0.y, c1.y, c2.x,
        c1.x, c2.x, c2.y
    );

    float s = 1.0 / (viewPos.z * viewPos.z);
    mat3 J = mat3(
        u_focal.x / viewPos.z,  0.0,                    -(u_focal.x * viewPos.x) * s,
        0.0,                     u_focal.y / viewPos.z,  -(u_focal.y * viewPos.y) * s,
        0.0,                     0.0,                     0.0
    );

    mat3 W     = transpose(mat3(modelViewMatrix));
    mat3 T     = W * J;
    mat3 cov2D = transpose(T) * Vrk * T;

#if ANTIALIASED
    float detOrig = cov2D[0][0] * cov2D[1][1] - cov2D[0][1] * cov2D[0][1];
#endif
    cov2D[0][0] += float(KERNEL_2D_SIZE);
    cov2D[1][1] += float(KERNEL_2D_SIZE);
#if ANTIALIASED
    float detBlur = cov2D[0][0] * cov2D[1][1] - cov2D[0][1] * cov2D[0][1];
    if (detBlur > 0.0) vColor.a *= sqrt(max(detOrig / detBlur, 0.0));
#endif
    if (vColor.a < 1.0 / 255.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

    float a = cov2D[0][0], d = cov2D[1][1], b = cov2D[0][1];
    float tr2  = 0.5 * (a + d);
    float term = sqrt(max(0.1, tr2 * tr2 - (a * d - b * b)));
    float ev1  = tr2 + term;
    float ev2  = tr2 - term;

    if (ev2 <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

    // Opacity × footprint area in pixels
    float contribution = vColor.a * 6.283185 * sqrt(max(a * d - b * b, 0.0));
    if (contribution < u_minContribution) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

    vec2 rawDir = vec2(b, ev1 - a);
    float rawLen = length(rawDir);
    vec2 ev1Dir = rawLen > 1e-4 ? rawDir / rawLen : vec2(1.0, 0.0);
    vec2 ev2Dir = vec2(ev1Dir.y, -ev1Dir.x);

    const float SQRT8 = 2.8284271247461903;
    const float EXP4 = 0.01831563888873418;
    // Shrink the quad to where the falloff drops below 1/255 for this
    // splat's opacity; the rest of the √8σ quad would only shade zeros
    float cutA = -log((1.0 - EXP4) / (255.0 * vColor.a) + EXP4) / 4.0;
    float extent = sqrt(clamp(cutA, 0.0, 1.0));
    vec2 bv1 = ev1Dir * u_splatScale * extent * min(SQRT8 * sqrt(ev1), float(MAX_SPLAT_SIZE));
    vec2 bv2 = ev2Dir * u_splatScale * extent * min(SQRT8 * sqrt(ev2), float(MAX_SPLAT_SIZE));

    vec3  ndc    = clipPos.xyz / clipPos.w;
    vec2  offset = (position.x * bv1 + position.y * bv2) * 2.0 / u_viewport;
    gl_Position  = vec4(ndc.xy + offset, ndc.z, 1.0);
    vPosition = position.xy * SQRT8 * extent;
}
`

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec4 vColor;
varying vec2 vPosition;

const float EXP4 = 0.01831563888873418;

void main() {
    float A = dot(vPosition, vPosition) / 8.0;
    // Clamped rather than discarded: discard is slower on tile-based GPUs
    float falloff = max((exp(-4.0 * A) - EXP4) / (1.0 - EXP4), 0.0);
    gl_FragColor = vec4(vColor.rgb, falloff * vColor.a);
}
`

const W = RAW_TEX_WIDTH // texture width (fixed at 2048)
const TEXELS_PER_SPLAT = UINTS_PER_SPLAT / 4
const SH_TEXELS = [0, 1, 4, 4]
// Wider than the splat texture: at 4 texels per splat, 2048 × 16384 would
// only hold SH for ~8.4M splats
const SH_TEX_WIDTH = 4096

const gl = (renderer: THREE.WebGLRenderer) =>
  renderer.getContext() as WebGL2RenderingContext

function splatRows(n: number) {
  return Math.max(1, Math.ceil((n * TEXELS_PER_SPLAT) / W))
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SplatMaterialOptions {
  splatScale?: number
  maxScreenSpaceSplatSize?: number
  kernel2DSize?: number
  antialiased?: boolean
  shBands?: number
  shRotation?: THREE.Matrix3
  /** Cull splats whose opacity × pixel area is below this (0 = off) */
  minContribution?: number
}

// ---------------------------------------------------------------------------
// SplatMaterial
// ---------------------------------------------------------------------------

export class SplatMaterial extends THREE.ShaderMaterial {
  private _splatRaw: RawTexture | null = null
  private _texCapacity = 0
  private _zeros = new Uint32Array(0)
  private _shRaw: RawTexture | null = null
  private readonly _shTexels: number

  constructor(options: SplatMaterialOptions = {}) {
    const {
      splatScale = 1.0,
      maxScreenSpaceSplatSize = 1024,
      minContribution = 0,
      kernel2DSize = 0.3,
      antialiased = false,
      shBands = 0,
      shRotation = new THREE.Matrix3(),
    } = options
    const shTexels = SH_TEXELS[shBands] ?? 0

    super({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      defines: {
        MAX_SPLAT_SIZE: maxScreenSpaceSplatSize,
        KERNEL_2D_SIZE: kernel2DSize.toFixed(6),
        ANTIALIASED: antialiased ? 1 : 0,
        COV_INV_SCALE: (1 / COV_SCALE).toExponential(),
        SH_BANDS: shBands,
        SH_TEXELS: shTexels,
      },
      uniforms: {
        u_splatTex: { value: null },
        u_texWidth: { value: W },
        u_viewport: { value: new THREE.Vector2(1, 1) },
        u_focal: { value: new THREE.Vector2(500, 500) },
        u_splatScale: { value: splatScale },
        u_minContribution: { value: minContribution },
        u_shTex: { value: null },
        u_shTexWidth: { value: SH_TEX_WIDTH },
        u_shRotation: { value: shRotation },
      },
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    })

    this._shTexels = shTexels
  }

  get texCapacity(): number {
    return this._texCapacity
  }

  // ---- Camera -------------------------------------------------------------

  updateFromCamera(
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number
  ): void {
    this.uniforms.u_viewport.value.set(width, height)
    const fovRad = (camera.fov * Math.PI) / 180
    const f = height / 2 / Math.tan(fovRad / 2)
    this.uniforms.u_focal.value.set(f, f)
  }

  // ---- GPU allocation -----------------------------------------------------

  /**
   * Ensure the GPU texture can hold at least `capacity` splat slots.
   * Growing allocates new storage and blits existing rows GPU→GPU, so no
   * CPU copy of the data is kept.
   */
  allocateForCapacity(capacity: number, renderer: THREE.WebGLRenderer): void {
    if (capacity <= this._texCapacity) return

    const firstInit = !this._splatRaw
    if (firstInit) this._splatRaw = new RawTexture(gl(renderer), "rgba32ui")

    this._texCapacity = capacity
    this._splatRaw!.ensureHeight(splatRows(capacity))

    if (firstInit) {
      this.uniforms.u_splatTex.value = this._splatRaw!.initHandle(renderer)
      if (this._shTexels > 0) {
        this._shRaw = new RawTexture(gl(renderer), "rgba32ui", SH_TEX_WIDTH)
        this.uniforms.u_shTex.value = this._shRaw.initHandle(renderer)
      }
    }

    // Sized up front like the splat texture: growing it as slices stream in
    // meant repeated reallocations and GPU copies of hundreds of MB
    this._shRaw?.ensureHeight(
      Math.min(
        Math.ceil((capacity * this._shTexels) / SH_TEX_WIDTH),
        this._shRaw.maxHeight
      )
    )
  }

  // ---- Slot writes --------------------------------------------------------

  /** Upload packed splats (see packing.ts) into [slotStart, slotStart+count). */
  uploadPacked(slotStart: number, count: number, packed: Uint32Array): void {
    if (!this._splatRaw) return
    this._splatRaw.writeTexels(
      slotStart * TEXELS_PER_SPLAT,
      count * TEXELS_PER_SPLAT,
      packed.subarray(0, count * UINTS_PER_SPLAT)
    )
  }

  /** Upload packed SH (see stelligra-wasm pack_sh) for a slot range. */
  uploadSH(slotStart: number, count: number, sh: Uint32Array): void {
    if (!this._shRaw) return
    const texelEnd = (slotStart + count) * this._shTexels
    if (texelEnd > this._shRaw.height * SH_TEX_WIDTH) return

    this._shRaw.writeTexels(
      slotStart * this._shTexels,
      count * this._shTexels,
      sh.subarray(0, count * this._shTexels * 4),
    )
  }

  /** Zero a slot range so its splats are culled (alpha 0). */
  zeroSlots(slotStart: number, count: number): void {
    const length = count * UINTS_PER_SPLAT
    if (this._zeros.length < length) this._zeros = new Uint32Array(length)
    this.uploadPacked(slotStart, count, this._zeros)
  }

  // ---- Dispose ------------------------------------------------------------

  dispose(): void {
    this._splatRaw?.dispose()
    this._splatRaw = null
    this._shRaw?.dispose()
    this._shRaw = null
    this._texCapacity = 0
    this._zeros = new Uint32Array(0)
    super.dispose()
  }
}
