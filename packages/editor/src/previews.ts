import { Catalyst, Model, Node3D, type Loader } from "@nickpaustian/catalyst"
import { Input } from "@nickpaustian/catalyst/input"
import { OrbitCamera } from "@nickpaustian/catalyst/prefabs"
import { parseHdr } from "@nickpaustian/obelisk"
import { color } from "./tokens/tokens"

const SIZE = 256
const YAW = (30 * Math.PI) / 180
const PITCH = (20 * Math.PI) / 180
/** Previews kept, newest last; each is a data url of a few tens of kilobytes. */
const KEPT = 64

/** A model file's preview: its picture and what it holds. */
export interface ModelPreview {
  image: string
  meshes: number
  triangles: number
}

const hex = (css: string): number => parseInt(css.replace("#", ""), 16)

/**
 * Put the orbit about the loaded model's sphere (the box around what the engine draws for it), with clip planes
 * that follow its size, and frame it. Null when nothing drew.
 */
const frameModel = (model: Model, orbit: OrbitCamera): { meshes: number; triangles: number } | null => {
  const box = model.drawnBounds()
  if (!box) return null
  const { min, max } = box
  orbit.transform.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2)
  orbit.radius = Math.max(1e-6, Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) / 2)
  // The clip planes follow the model's size, so a small object is not cut away by the default near plane.
  orbit.camera.near = orbit.radius * 0.01
  orbit.camera.far = orbit.radius * 100
  orbit.fit(true)
  return model.stats
}

const toDataUrl = (rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): string => {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, width, height), 0, 0)
  return canvas.toDataURL("image/png")
}

/**
 * Pictures of the project's model and environment files for the files pane.
 * A model is drawn by an engine of its own, off screen and made on first use,
 * so it looks as it will in the scene: framed from three-quarter view, the
 * same yaw and pitch a theca's thumbnail and Plynth's camera use. It renders
 * only when asked, one preview at a time. An environment is tone mapped flat.
 */
export class Previews {
  private engine: Catalyst | null = null
  private host: HTMLElement | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly cache = new Map<string, Promise<unknown>>()

  /** The model at `path` drawn through `loader`; the same file unchanged since (`modified`) is not drawn again. */
  model(loader: Loader, path: string, modified: number): Promise<ModelPreview | null> {
    return this.remember(`model:${path}:${modified}`, () => this.drawModel(loader, path)) as Promise<ModelPreview | null>
  }

  /** The environment at `path`, its whole panorama tone mapped. */
  environment(loader: Loader, path: string, modified: number): Promise<string | null> {
    return this.remember(`hdr:${path}:${modified}`, async () => {
      const hdr = parseHdr(await loader.arrayBuffer(path))
      const width = SIZE
      const height = Math.max(1, Math.round((SIZE * hdr.height) / hdr.width))
      const out = new Uint8ClampedArray(width * height * 4)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const at = (Math.floor((y * hdr.height) / height) * hdr.width + Math.floor((x * hdr.width) / width)) * 3
          for (let k = 0; k < 3; k++) {
            const v = hdr.data[at + k]
            out[(y * width + x) * 4 + k] = 255 * Math.pow(v / (1 + v), 1 / 2.2)
          }
          out[(y * width + x) * 4 + 3] = 255
        }
      }
      return toDataUrl(out, width, height)
    }) as Promise<string | null>
  }

  dispose(): void {
    this.engine?.dispose()
    this.engine = null
    this.host?.remove()
    this.host = null
    this.cache.clear()
  }

  private remember(key: string, make: () => Promise<unknown>): Promise<unknown> {
    let made = this.cache.get(key)
    if (!made) {
      made = (this.queue = this.queue.then(make, make)).catch(() => null)
      this.cache.set(key, made)
      if (this.cache.size > KEPT) this.cache.delete(this.cache.keys().next().value!)
    }
    return made
  }

  private async drawModel(loader: Loader, path: string): Promise<ModelPreview | null> {
    const engine = await this.preparedEngine()
    if (!engine.renderer) return null
    engine.loader = loader
    const root = new Node3D("preview")
    const model = new Model({ url: path })
    const orbit = new OrbitCamera({ yaw: (YAW * 180) / Math.PI, pitch: (PITCH * 180) / Math.PI, autoTurn: 0 })
    root.addNode(model)
    root.addNode(orbit)
    engine.add(root)
    try {
      await model.ready
      engine.camera.target = orbit.camera
      const framed = frameModel(model, orbit)
      if (!framed) return null
      engine.step(1 / 60)
      engine.step(1 / 60)
      const pixels = await engine.renderer.snapshot(SIZE, SIZE)
      return { image: toDataUrl(Uint8ClampedArray.from(pixels), SIZE, SIZE), ...framed }
    } finally {
      engine.camera.target = null
      root.dispose()
    }
  }

  private async preparedEngine(): Promise<Catalyst> {
    if (this.engine) return this.engine
    const host = document.createElement("div")
    host.setAttribute("aria-hidden", "true")
    host.style.cssText = `position:fixed;left:-${SIZE * 4}px;top:0;width:${SIZE}px;height:${SIZE}px;pointer-events:none;visibility:hidden`
    document.body.appendChild(host)
    this.host = host
    const engine = new Catalyst({ container: host, background: hex(color.bg.panel), render: { pixelRatio: 1 }, log: () => undefined })
    this.engine = engine
    await engine.ready
    return engine
  }
}

/**
 * A model to turn over in the preview window: a live engine of its own in `host`, with an orbit
 * camera (drag turns, right-drag or shift-drag pans, the wheel zooms, F frames). It runs only
 * while it is shown; `dispose` lets its GPU device go.
 */
export class ModelViewer {
  private engine: Catalyst | null = null
  private root: Node3D | null = null
  private orbit: OrbitCamera | null = null
  private generation = 0
  /** The element the viewer draws in. */
  readonly host: HTMLElement

  constructor(host: HTMLElement) {
    this.host = host
  }

  /** Show the model at `path`, read through `loader`; what it holds, or null when nothing drew. */
  async show(loader: Loader, path: string): Promise<{ meshes: number; triangles: number } | null> {
    const generation = ++this.generation
    if (!this.engine) {
      this.engine = new Catalyst({ container: this.host, background: hex(color.bg.panel), render: { pixelRatio: Math.min(2, window.devicePixelRatio || 1) }, modules: [new Input()], log: () => undefined })
      this.engine.start()
    }
    const engine = this.engine
    await engine.ready
    if (generation !== this.generation || this.engine !== engine) return null
    this.root?.dispose()
    engine.loader = loader
    const root = new Node3D("preview")
    const model = new Model({ url: path })
    const orbit = new OrbitCamera({ yaw: (YAW * 180) / Math.PI, pitch: (PITCH * 180) / Math.PI, autoTurn: 0 })
    root.addNode(model)
    root.addNode(orbit)
    engine.add(root)
    engine.camera.target = orbit.camera
    this.root = root
    this.orbit = orbit
    await model.ready
    if (generation !== this.generation) return null
    return frameModel(model, orbit)
  }

  fit(): void {
    this.orbit?.fit()
  }

  dispose(): void {
    this.generation++
    this.root?.dispose()
    this.root = null
    this.orbit = null
    this.engine?.dispose()
    this.engine = null
  }
}
