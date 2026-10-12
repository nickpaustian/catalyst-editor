import * as THREE from "three"

// Must match SplatMaterial's TEX_WIDTH and SortKeyPass's TEX_WIDTH.
export const RAW_TEX_WIDTH = 2048

// Subset of Three.js's internal texture property bag we care about.
type ThreeTexProps = Record<string, unknown> & {
  __webglTexture?: WebGLTexture | null
  __version?: number
}

export type TexFmt = "rgba32f" | "rgba8" | "rgba32ui"

/**
 * Raw WebGL2 texture managed entirely outside Three.js's upload pipeline.
 *
 * ### Grow (ensureHeight)
 *   1. gl.texImage2D(null)    — allocate GPU storage, zero CPU cost
 *   2. gl.blitFramebuffer     — copy existing rows GPU→GPU, no CPU→GPU DMA
 *   3. swap old for new, delete old
 *
 * ### Write (writeRows)
 *   gl.texSubImage2D for exactly the dirty rows — O(N_new) only.
 *
 * ### Three.js integration
 *   initHandle() creates a 1×1 DataTexture, force-uploads it via
 *   renderer.initTexture(), then patches its internal __webglTexture property
 *   to point at our raw texture. Three.js reads that property when binding
 *   sampler uniforms and never re-uploads because handle.needsUpdate stays false.
 *   On grow, we update __webglTexture in place — no handle replacement needed.
 *
 * ### Float textures (rgba32f)
 *   blitFramebuffer on RGBA32F requires EXT_color_buffer_float. This is
 *   universally supported on all WebGL2 targets. If somehow unavailable the
 *   blit is skipped and the caller must re-upload existing data manually.
 */
export class RawTexture {
  private readonly _gl: WebGL2RenderingContext
  private _tex: WebGLTexture
  private readonly _iFmt: number // internalFormat  (e.g. gl.RGBA32F)
  private readonly _fmt: number // format          (e.g. gl.RGBA)
  private readonly _type: number // type            (e.g. gl.FLOAT)
  readonly width: number
  private _height = 0

  // Whether blitFramebuffer can be used for this texture's format.
  // RGBA8 — always OK. RGBA32F — requires EXT_color_buffer_float.
  private readonly _canBlit: boolean

  // Reused FBO pair for grow blits.
  private readonly _readFbo: WebGLFramebuffer
  private readonly _drawFbo: WebGLFramebuffer

  // Three.js DataTexture "handle" (1×1, uploaded once, __webglTexture patched).
  private _handle: THREE.DataTexture | null = null
  private _props: ThreeTexProps | null = null

  constructor(
    gl: WebGL2RenderingContext,
    fmt: TexFmt,
    width = RAW_TEX_WIDTH
  ) {
    this._gl = gl
    this.width = width

    if (fmt === "rgba32f") {
      this._iFmt = gl.RGBA32F
      this._fmt = gl.RGBA
      this._type = gl.FLOAT
      this._canBlit = !!gl.getExtension("EXT_color_buffer_float")
    } else if (fmt === "rgba32ui") {
      this._iFmt = gl.RGBA32UI
      this._fmt = gl.RGBA_INTEGER
      this._type = gl.UNSIGNED_INT
      this._canBlit = true
    } else {
      this._iFmt = gl.RGBA8
      this._fmt = gl.RGBA
      this._type = gl.UNSIGNED_BYTE
      this._canBlit = true // RGBA8 is always color-renderable in WebGL2
    }

    this._tex = this._newTex()
    this._readFbo = gl.createFramebuffer()!
    this._drawFbo = gl.createFramebuffer()!
  }

  get height(): number {
    return this._height
  }
  get glTex(): WebGLTexture {
    return this._tex
  }
  get canBlit(): boolean {
    return this._canBlit
  }
  get maxHeight(): number {
    return this._gl.getParameter(this._gl.MAX_TEXTURE_SIZE) as number
  }

  // ---- Grow -----------------------------------------------------------------

  /**
   * Ensure at least `newHeight` rows of GPU storage exist.
   *
   * If growing: allocates a new texture with texImage2D(null) (zero upload
   * cost), blits existing rows GPU→GPU, swaps old for new, deletes old.
   *
   * Returns true if the GL handle changed (Three.js handle already patched).
   * Returns false if no grow was needed.
   *
   * If `_canBlit` is false (rare — EXT_color_buffer_float unavailable),
   * the new texture is allocated but NOT populated with old data. The caller
   * is responsible for re-uploading existing data via writeRows().
   */
  ensureHeight(newHeight: number): boolean {
    if (newHeight <= this._height) return false

    const gl = this._gl
    const prev = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
    const newT = this._newTex()

    // Allocate GPU storage — no data upload, near-zero cost.
    gl.bindTexture(gl.TEXTURE_2D, newT)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      this._iFmt,
      this.width,
      newHeight,
      0,
      this._fmt,
      this._type,
      null
    )

    // Copy existing rows GPU→GPU.
    if (this._height > 0 && this._canBlit) {
      // Save the caller's framebuffer bindings (Three.js may have its own).
      const prevR = gl.getParameter(
        gl.READ_FRAMEBUFFER_BINDING
      ) as WebGLFramebuffer | null
      const prevD = gl.getParameter(
        gl.DRAW_FRAMEBUFFER_BINDING
      ) as WebGLFramebuffer | null

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._readFbo)
      gl.framebufferTexture2D(
        gl.READ_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        this._tex,
        0
      )
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._drawFbo)
      gl.framebufferTexture2D(
        gl.DRAW_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        newT,
        0
      )

      gl.blitFramebuffer(
        0,
        0,
        this.width,
        this._height,
        0,
        0,
        this.width,
        this._height,
        gl.COLOR_BUFFER_BIT,
        gl.NEAREST
      )

      // Detach textures from FBOs before restore (prevents dangling references).
      gl.framebufferTexture2D(
        gl.READ_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        null,
        0
      )
      gl.framebufferTexture2D(
        gl.DRAW_FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        null,
        0
      )

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevR)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevD)
    }

    gl.deleteTexture(this._tex)
    this._tex = newT
    this._height = newHeight

    // Patch the Three.js handle in-place — no handle replacement needed.
    if (this._props) this._props.__webglTexture = newT

    // Restore the previous binding so Three.js's texture-unit state cache
    // remains consistent after our raw GL calls.
    gl.bindTexture(gl.TEXTURE_2D, prev)

    return true
  }

  // ---- Write ----------------------------------------------------------------

  /**
   * Upload `rowCount` rows starting at `rowStart` from `data`.
   * `data` must cover exactly `width × rowCount` texels in this texture's format.
   */
  writeRows(rowStart: number, rowCount: number, data: ArrayBufferView): void {
    const gl = this._gl
    // Save and restore the current binding for the active texture unit so that
    // Three.js's internal texture-unit state cache stays consistent. Without
    // this, Three.js may skip a rebind on the next draw call (because it still
    // thinks the old texture is bound) even though our upload changed what is
    // physically bound to that unit — causing the wrong sampler data to be read.
    const prev = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
    gl.bindTexture(gl.TEXTURE_2D, this._tex)
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      rowStart,
      this.width,
      rowCount,
      this._fmt,
      this._type,
      data
    )
    gl.bindTexture(gl.TEXTURE_2D, prev)
  }

  /**
   * Upload `texelCount` texels starting at linear texel index `texelStart`,
   * which need not be row-aligned. `data` holds exactly those texels.
   */
  writeTexels(texelStart: number, texelCount: number, data: Uint32Array): void {
    const gl = this._gl
    const w = this.width
    const prev = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
    gl.bindTexture(gl.TEXTURE_2D, this._tex)

    const upload = (
      x: number,
      y: number,
      width: number,
      height: number,
      from: number
    ) =>
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        x,
        y,
        width,
        height,
        this._fmt,
        this._type,
        data.subarray(from * 4, (from + width * height) * 4)
      )

    let texel = texelStart
    let uploaded = 0
    let remaining = texelCount

    const firstX = texel % w
    if (firstX !== 0 && remaining > 0) {
      const n = Math.min(w - firstX, remaining)
      upload(firstX, Math.floor(texel / w), n, 1, uploaded)
      texel += n
      uploaded += n
      remaining -= n
    }

    const fullRows = Math.floor(remaining / w)
    if (fullRows > 0) {
      upload(0, texel / w, w, fullRows, uploaded)
      texel += fullRows * w
      uploaded += fullRows * w
      remaining -= fullRows * w
    }

    if (remaining > 0) upload(0, texel / w, remaining, 1, uploaded)

    gl.bindTexture(gl.TEXTURE_2D, prev)
  }

  // ---- Three.js integration ------------------------------------------------

  /**
   * Create (once) a 1×1 DataTexture as a uniform "handle".
   *
   * Three.js uploads it immediately via renderer.initTexture(), then we patch
   * __webglTexture to point at our raw texture. Three.js binds __webglTexture
   * on every draw call without ever re-uploading, because handle.needsUpdate
   * stays false and the version never changes.
   *
   * On subsequent grows ensureHeight() patches __webglTexture in-place.
   * Idempotent — safe to call multiple times, returns the same handle.
   */
  initHandle(renderer: THREE.WebGLRenderer): THREE.DataTexture {
    if (this._handle) return this._handle

    // 1×1 placeholder — uploaded once, then patched.
    const handle = new THREE.DataTexture(
      new Float32Array(4),
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType
    )
    handle.needsUpdate = true
    renderer.initTexture(handle) // forces Three.js to create the properties entry + upload 1 texel
    handle.needsUpdate = false // prevent Three.js from ever re-uploading

    const props = renderer.properties.get(handle) as ThreeTexProps
    props.__webglTexture = this._tex
    props.__version = handle.version

    this._handle = handle
    this._props = props
    return handle
  }

  // ---- Dispose -------------------------------------------------------------

  dispose(): void {
    const gl = this._gl
    gl.deleteTexture(this._tex)
    gl.deleteFramebuffer(this._readFbo)
    gl.deleteFramebuffer(this._drawFbo)
    this._handle?.dispose()
    this._handle = null
    this._props = null
    this._height = 0
  }

  // ---- Private -------------------------------------------------------------

  private _newTex(): WebGLTexture {
    const gl = this._gl
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }
}
