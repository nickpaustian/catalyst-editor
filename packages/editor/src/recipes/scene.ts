import { Button, Camera, Colour, Grid, Html, Sprite, Label, Light, Model, Node3D, Panel, Path, Picture, Slate, Stack, UIElement, StreamedSurface, TextField, Toggle, Line, type AntiAliasing, type Catalyst, type MetadataLink, type NodeJSON, type RenderSettings, type SceneMetadata } from "@nickpaustian/catalyst"
import { pickFile } from "../ProjectFolder"
import { Interactable } from "@nickpaustian/catalyst/interaction"
import { BoxCollider, CapsuleCollider, MeshCollider, SphereCollider } from "@nickpaustian/catalyst/physics"
import { Box, Capsule, Cylinder, EditMesh, FirstPersonController, FocalPoint, FocalPointTrigger, OrbitCamera, PointOfInterest, Sphere, Wedge } from "@nickpaustian/catalyst/prefabs"
import type { ToneMapping } from "@nickpaustian/obelisk"
import { Physics } from "@nickpaustian/catalyst/physics"
import { Vector3 } from "@nickpaustian/catalyst"
import type { Recipe } from "../recipe"
import { PlayerStart } from "./playerStart"
import { Component } from "../ui/Component"

export const SCENE_FILE = "scene.json"

export interface SceneEnvironment {
  /** A y no body falls below, or null for none. Default 0, so a scene needs no floor to stand on. */
  floor: number | null
  gravity: number
  drag: number
  /** Light from everywhere, as a hex colour and a strength. */
  ambient: number
  ambientIntensity: number
  /** A white light from the camera; 0 for none. */
  headlight: number
  /** An equirectangular .hdr in the project that lights the scene, or null for none. */
  environment: string | null
  environmentIntensity: number
  toneMapping: ToneMapping
  /** In stops. */
  exposure: number
  /** How a run draws; the editor's own viewport keeps its settings. */
  antialias: AntiAliasing
  pixelRatio: number
  renderScale: number
  adaptiveScale: boolean
}

const ANTI_ALIASING: AntiAliasing[] = ["taa", "msaa", "none"]
/** The run's render settings per engine, as the scene last set them; the editor viewport does not draw with them. */
const renderSettings = new WeakMap<Catalyst, RenderSettings>()
const renderOf = (engine: Catalyst): RenderSettings => renderSettings.get(engine) ?? { antialias: DEFAULT_ENVIRONMENT.antialias, pixelRatio: DEFAULT_ENVIRONMENT.pixelRatio, renderScale: DEFAULT_ENVIRONMENT.renderScale, adaptiveScale: DEFAULT_ENVIRONMENT.adaptiveScale, gpuTiming: false }

const TONE_MAPPINGS: ToneMapping[] = ["none", "neutral", "aces"]
const DEFAULT_ENVIRONMENT: SceneEnvironment = { floor: 0, gravity: 9.8, drag: 0.1, ambient: 0xffffff, ambientIntensity: 0.35, headlight: 0.4, environment: null, environmentIntensity: 1, toneMapping: "none", exposure: 0, antialias: "taa", pixelRatio: 2, renderScale: 1, adaptiveScale: true }

const hexOf = (c: Colour): number => (Math.round(c.x) << 16) | (Math.round(c.y) << 8) | Math.round(c.z)
const colourOf = (hex: number): Colour => new Colour((hex >> 16) & 255, (hex >> 8) & 255, hex & 255)

const readEnvironment = (engine: Catalyst): SceneEnvironment => {
  const world = engine.find(Physics)?.world
  const lighting = engine.lighting
  const physics = world ? { floor: world.floor, gravity: world.gravity, drag: world.drag } : DEFAULT_ENVIRONMENT
  return {
    floor: physics.floor,
    gravity: physics.gravity,
    drag: physics.drag,
    ambient: hexOf(lighting.ambient),
    ambientIntensity: lighting.ambientIntensity,
    headlight: lighting.headlight,
    environment: engine.environment?.url ?? null,
    environmentIntensity: engine.environment?.intensity ?? 1,
    toneMapping: engine.toneMapping,
    exposure: engine.exposure,
    antialias: renderOf(engine).antialias,
    pixelRatio: renderOf(engine).pixelRatio,
    renderScale: renderOf(engine).renderScale,
    adaptiveScale: renderOf(engine).adaptiveScale,
  }
}
/** `running` applies the render settings to the engine too; while editing they are only kept for the run. */
const applyEnvironment = (engine: Catalyst, environment: Partial<SceneEnvironment> | undefined, running = false): void => {
  const next = { ...DEFAULT_ENVIRONMENT, ...environment }
  const render: RenderSettings = { antialias: ANTI_ALIASING.includes(next.antialias) ? next.antialias : "taa", pixelRatio: next.pixelRatio, renderScale: next.renderScale, adaptiveScale: next.adaptiveScale, gpuTiming: false }
  renderSettings.set(engine, render)
  if (running) engine.render.apply({ ...render, gpuTiming: engine.render.gpuTiming })
  const world = engine.find(Physics)?.world
  if (world) {
    world.floor = next.floor
    world.gravity = next.gravity
    world.drag = next.drag
  }
  engine.lighting = { ...engine.lighting, ambient: colourOf(next.ambient), ambientIntensity: next.ambientIntensity, headlight: next.headlight }
  const hdr = next.environment ? { url: next.environment, intensity: next.environmentIntensity } : null
  if (JSON.stringify(hdr) !== JSON.stringify(engine.environment)) engine.environment = hdr
  engine.toneMapping = TONE_MAPPINGS.includes(next.toneMapping) ? next.toneMapping : "none"
  engine.exposure = next.exposure
}

const RECORD_TEXT = ["title", "maker", "date", "credit", "licence", "description"] as const
const RECORD_KEYS = new Set<string>([...RECORD_TEXT, "links", "unit", "unitScale"])

/** One link a line, its label then its url; a line that is only a url is labelled by it. */
const linksOf = (text: string): MetadataLink[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.search(/\S+$/)
      const url = line.slice(at)
      const label = line.slice(0, at).trim()
      return { label: label || url, url }
    })

const linksText = (links: MetadataLink[] | undefined): string => (links ?? []).map((link) => (link.label && link.label !== link.url ? `${link.label} ${link.url}` : link.url)).join("\n")

/** The record as the settings show it: the links as lines, the units as a name and a scale. */
const readRecord = (metadata: SceneMetadata): Record<string, unknown> => ({
  ...Object.fromEntries(RECORD_TEXT.map((key) => [key, metadata[key] ?? ""])),
  links: linksText(metadata.links),
  unit: metadata.units?.unit ?? "",
  unitScale: metadata.units?.scale ?? 1,
})

/** The record with one setting changed; empty fields are left out of it. */
const writeRecord = (metadata: SceneMetadata, key: string, value: unknown): SceneMetadata => {
  const next: SceneMetadata = { ...metadata }
  if (key === "links") next.links = linksOf(String(value ?? ""))
  else if (key === "unit" || key === "unitScale") {
    const unit = key === "unit" ? String(value ?? "").trim() : (metadata.units?.unit ?? "")
    const scale = key === "unitScale" ? Number(value) : (metadata.units?.scale ?? 1)
    next.units = unit ? { unit, ...(Number.isFinite(scale) && scale !== 1 ? { scale } : {}) } : undefined
  } else (next as Record<string, unknown>)[key] = String(value ?? "").trim() || undefined
  if (next.links?.length === 0) next.links = undefined
  return JSON.parse(JSON.stringify(next)) as SceneMetadata
}

const metadataOf = (scene: unknown): SceneMetadata => {
  const metadata = (scene as { metadata?: unknown } | null)?.metadata
  return metadata && typeof metadata === "object" ? (metadata as SceneMetadata) : {}
}

/** The scene file with the environment, and the record when it says anything, beside the nodes. */
const toFile = (engine: Catalyst, root: Node3D): NodeJSON & { environment: SceneEnvironment; metadata?: SceneMetadata } => ({
  ...engine.serialise(root),
  environment: readEnvironment(engine),
  ...(Object.keys(engine.metadata).length ? { metadata: engine.metadata } : {}),
})

/** A plain Catalyst scene: a folder holding `scene.json` and whatever it names. */
export const sceneRecipe: Recipe = {
  name: "scene",
  files: [SCENE_FILE],
  kinds: [
    { kind: "Group", label: "Group", cls: Node3D, description: "An empty spatial node: a place to gather other nodes under one transform.", make: ({ name }) => new Node3D(name) },
    {
      kind: "Path",
      label: "Path",
      cls: Path,
      description: "A route through its children, in order: move them with the gizmo and the curve follows. Scripts ask it for a point or direction a distance along, for patrols, rails and enemy routes.",
      make: (o) => {
        const path = new Path(o)
        for (const [name, x] of [["1", -1], ["2", 1]] as const) {
          const waypoint = new Node3D(name)
          waypoint.transform.position.set(x, 0, 0)
          path.addNode(waypoint)
        }
        return path
      },
    },
    {
      kind: "Grid",
      label: "Grid",
      cls: Grid,
      description: "A map of square cells, each one of a palette of tile types with tags your scripts read (walk, place…). Paint it in the viewport; scripts ask it for cells, centres and routes.",
      make: (o) =>
        new Grid({
          ...o,
          columns: 8,
          rows: 6,
          tiles: [
            { name: "floor", colour: 0x7d8a6a, height: 0, tags: ["walk"] },
            { name: "raised", colour: 0x8b8f99, height: 0.5, tags: [] },
            { name: "wall", colour: 0x3b3f47, height: 1, tags: [] },
          ],
        }),
    },
    {
      kind: "Sprite",
      label: "Sprite",
      cls: Sprite,
      description: "Pixel art from a sheet of frames, standing on its position and turned to the camera, sharp and cut out; it plays named animations (name, frames, frames a second, once).",
      make: (o) => new Sprite({ ...o, columns: 4, rows: 3, animations: "idle 0-3 4\nwalk 4-7 8\nattack 8-11 10 once", animation: "idle" }),
    },
    { kind: "PlayerStart", label: "Player start", cls: PlayerStart, description: "Where a run puts the player: its position and facing. The first one in the scene is used.", make: (o) => new PlayerStart(o) },
    { kind: "Box", label: "Box", cls: Box, description: "A block with a mesh and a matching collider: floors, walls, crates.", make: (o) => new Box(o) },
    { kind: "Sphere", label: "Sphere", cls: Sphere, description: "A ball with a mesh and a matching collider.", make: (o) => new Sphere(o) },
    { kind: "Capsule", label: "Capsule", cls: Capsule, description: "A pillar or a stand-in body with a mesh and a matching collider.", make: (o) => new Capsule(o) },
    { kind: "EditMesh", label: "Mesh (editable)", cls: EditMesh, description: "A mesh whose vertices you move by hand with the vertex tool (Tab): starts as a cube. Any primitive can be converted to one from its menu.", make: (o) => new EditMesh(o) },
    { kind: "Cylinder", label: "Cylinder", cls: Cylinder, description: "A round pillar with a mesh collider the same shape, standing on y.", make: (o) => new Cylinder(o) },
    { kind: "Wedge", label: "Wedge", cls: Wedge, description: "A ramp with a mesh collider the same shape: full height along its back edge, sloping down to nothing at the front. Turn it to face the way it should rise.", make: (o) => new Wedge(o) },
    {
      kind: "Model",
      label: "Model",
      cls: Model,
      description: "A glTF model (.glb) imported into the project's assets and placed at the node.",
      pick: async (folder) => {
        const file = await pickFile(".glb,.gltf,model/gltf-binary,model/gltf+json")
        return file ? { url: await folder.importFile(file), name: file.name.replace(/\.[^.]+$/, "") } : null
      },
      make: (o) => new Model({ ...o, url: String(o.url ?? "") }),
    },
    {
      kind: "StreamedSurface",
      label: "Streamed surface",
      cls: StreamedSurface,
      description: "A scanned object streamed at full detail: a Theia cluster hierarchy, with an Atlas tile pyramid for its maps. Give it the folders' urls; the budgets can be tuned live.",
      make: (o) => new StreamedSurface({ ...o, clusters: String(o.clusters ?? ""), tiles: String(o.tiles ?? "") }),
    },
    {
      kind: "OrbitCamera",
      label: "Orbit camera",
      cls: OrbitCamera,
      description: "A turntable about this node: a run starts here, with the pointer turning, panning and zooming around the subject instead of walking. Set its radius to the size of what sits at the node.",
      make: (o) => new OrbitCamera({ ...o, radius: 1 }),
    },
    { kind: "Camera", label: "Camera", cls: Camera, description: "A perspective camera with a real lens: a focal length over a sensor.", make: (o) => new Camera(o) },
    { kind: "Light", label: "Light", cls: Light, description: "A directional light shining along the node's -z, like the sun: only its rotation matters. With none in the scene the engine's default sun is used.", make: (o) => new Light(o) },
    { kind: "BoxCollider", label: "Box collider", cls: BoxCollider, description: "An invisible box the physics world collides with, or a trigger volume.", make: (o) => new BoxCollider({ ...o, width: 1, height: 1, depth: 1 }) },
    { kind: "SphereCollider", label: "Sphere collider", cls: SphereCollider, description: "An invisible sphere the physics world collides with, or a trigger volume.", make: (o) => new SphereCollider({ ...o, radius: 0.5 }) },
    { kind: "CapsuleCollider", label: "Capsule collider", cls: CapsuleCollider, description: "An invisible capsule the physics world collides with, standing on y.", make: (o) => new CapsuleCollider({ ...o, radius: 0.3, height: 1.8 }) },
    {
      kind: "MeshCollider",
      label: "Mesh collider",
      cls: MeshCollider,
      description: "Collision against the triangles of a glTF model imported into the project: a scanned room or a shaped floor.",
      pick: async (folder) => {
        const file = await pickFile(".glb,.gltf,model/gltf-binary,model/gltf+json")
        return file ? { url: await folder.importFile(file), name: file.name.replace(/\.[^.]+$/, "") } : null
      },
      make: (o) => new MeshCollider({ ...o, url: String(o.url ?? "") }),
    },
    { kind: "Slate", label: "Slate", cls: Slate, description: "A canvas for UI over the scene, styled by its own stylesheet: one per screen, such as a HUD, a menu or a modal.", make: (o) => new Slate(o) },
    { kind: "Panel", label: "Panel", cls: Panel, description: "A box on a slate with a background, padding and rounded corners around the UI under it.", make: (o) => new Panel(o) },
    { kind: "Stack", label: "Stack", cls: Stack, description: "UI in a row or a column with a gap between: a toolbar, a menu, a form.", make: (o) => new Stack(o) },
    { kind: "Label", label: "Label", cls: Label, description: "Text on a slate.", make: (o) => new Label({ text: "Label", ...o }) },
    { kind: "Button", label: "Button", cls: Button, description: "A button on a slate; scripts hear it through its onPressed signal.", make: (o) => new Button(o) },
    { kind: "Picture", label: "Picture", cls: Picture, description: "An image from the project on a slate.", make: (o) => new Picture(o) },
    { kind: "Toggle", label: "Toggle", cls: Toggle, description: "A checkbox with a label on a slate; scripts hear it through its onChanged signal.", make: (o) => new Toggle({ text: "Toggle", ...o }) },
    { kind: "TextField", label: "Text field", cls: TextField, description: "A line of text to type on a slate; scripts hear it through its onChanged and onSubmitted signals.", make: (o) => new TextField(o) },
    { kind: "Line", label: "Line", cls: Line, description: "A straight line over a slate or the UI node it is in, with a dot or an arrowhead: an aim, a link, a guide.", make: (o) => new Line({ end: "arrow", ...o }) },
    { kind: "Component", label: "Component", cls: Component, description: "A Lightspeed component from a .lsp file in the project, on a slate.", make: (o) => new Component(o) },
    { kind: "Html", label: "HTML", cls: Html, description: "Markup on a slate, from an .html file or written in place, styled by the slate's stylesheet.", make: (o) => new Html(o) },
    { kind: "Interactable", label: "Interactable", cls: Interactable, description: "Something the pointer or crosshair can land on and click, with focus and interact signals for your code.", make: (o) => new Interactable({ ...o, radius: 0.25 }) },
    { kind: "PointOfInterest", label: "Point of interest", cls: PointOfInterest, description: "An interactable with a marker on screen that fades with distance and hides when something is in the way.", make: (o) => new PointOfInterest(o) },
    { kind: "FocalPoint", label: "Focal point", cls: FocalPoint, description: "Somewhere a guided camera turns to look while it is enabled.", make: (o) => new FocalPoint(o) },
    { kind: "FocalPointTrigger", label: "Trigger", cls: FocalPointTrigger, description: "A box that turns its focal points on while the player is inside it.", make: (o) => new FocalPointTrigger({ ...o, width: 1, height: 2, depth: 1 }) },
  ],
  settings: {
    title: "Environment",
    fields: [
      { section: "Record", key: "title", type: "string" },
      { section: "Record", key: "maker", type: "string" },
      { section: "Record", key: "date", type: "string" },
      { section: "Record", key: "credit", type: "string" },
      { section: "Record", key: "licence", type: "string" },
      { section: "Record", key: "description", type: "text" },
      { section: "Record", key: "links", label: "Links", type: "text" },
      { section: "Record", key: "unit", type: "string" },
      { section: "Record", key: "unitScale", label: "Unit scale", type: "number", min: 0, step: 0.001 },
      { section: "Lighting", key: "environment", label: "Environment", type: "file", accept: ".hdr" },
      { section: "Lighting", key: "environmentIntensity", label: "Environment strength", type: "number", min: 0, step: 0.05 },
      { section: "Lighting", key: "ambient", label: "Ambient", type: "colour" },
      { section: "Lighting", key: "ambientIntensity", label: "Ambient strength", type: "number", min: 0, step: 0.05 },
      { section: "Lighting", key: "headlight", label: "Headlight", type: "number", min: 0, step: 0.05 },
      { section: "Tone", key: "toneMapping", label: "Tone map", type: "select", options: TONE_MAPPINGS },
      { section: "Tone", key: "exposure", label: "Exposure", type: "number", step: 0.1 },
      { section: "Physics", key: "floored", label: "Floor", type: "boolean" },
      { section: "Physics", key: "floor", label: "Floor height", type: "number", step: 0.1 },
      { section: "Physics", key: "gravity", type: "number", min: 0, step: 0.1 },
      { section: "Physics", key: "drag", type: "number", min: 0, max: 1, step: 0.01 },
      { section: "Rendering", key: "antialias", label: "Anti-aliasing", type: "select", options: ANTI_ALIASING },
      { section: "Rendering", key: "pixelRatio", label: "Pixel ratio", type: "number", min: 0.5, max: 3, step: 0.25 },
      { section: "Rendering", key: "renderScale", label: "Render scale", type: "number", min: 0.5, max: 1, step: 0.05 },
      { section: "Rendering", key: "adaptiveScale", label: "Adaptive scale", type: "boolean" },
    ],
    read: (engine) => {
      const environment = readEnvironment(engine)
      const { floor, ...rest } = environment
      return { ...readRecord(engine.metadata), floored: floor !== null, floor: floor ?? 0, ...rest }
    },
    write: (engine, _root, key, value) => {
      if (RECORD_KEYS.has(key)) {
        engine.metadata = writeRecord(engine.metadata, key, value)
        return
      }
      const current = readEnvironment(engine)
      if (key === "floored") applyEnvironment(engine, { ...current, floor: value ? (current.floor ?? 0) : null })
      else if (key === "floor") applyEnvironment(engine, { ...current, floor: Number(value) })
      else applyEnvironment(engine, { ...current, [key]: value })
    },
  },
  load: async (folder, engine) => {
    applyEnvironment(engine, undefined)
    engine.metadata = {}
    if (folder && (await folder.exists(SCENE_FILE))) {
      const json = await folder.readJSON<(NodeJSON & { environment?: Partial<SceneEnvironment> }) | NodeJSON[]>(SCENE_FILE)
      if (Array.isArray(json)) {
        const root = new Node3D("scene")
        for (const entry of json) root.addNode(engine.create(entry))
        return root
      }
      applyEnvironment(engine, json.environment)
      engine.metadata = metadataOf(json)
      const root = engine.create(json)
      if (root instanceof Node3D) return root
      const wrapped = new Node3D("scene")
      wrapped.addNode(root)
      return wrapped
    }
    return new Node3D("scene")
  },
  serialise: (root, engine) => toFile(engine, root),
  save: async (folder, root, engine) => {
    await folder.writeJSON(SCENE_FILE, toFile(engine, root))
    return [SCENE_FILE]
  },
  download: (root, engine) => ({ name: SCENE_FILE, text: JSON.stringify(toFile(engine, root), null, 2) + "\n" }),
  run: async ({ engine, root, scene }) => {
    applyEnvironment(engine, (scene as { environment?: Partial<SceneEnvironment> }).environment, true)
    engine.metadata = metadataOf(scene)
    const physics = engine.find(Physics)
    let current: Camera | null = null
    root.walk((node) => {
      if (!current && node instanceof Camera && node.current) current = node
    })
    if (current) {
      engine.camera.target = current
      if (physics) physics.paused = false
      return () => {
        if (physics) physics.paused = true
      }
    }
    let orbit: OrbitCamera | null = null
    root.walk((node) => {
      if (!orbit && node instanceof OrbitCamera) orbit = node
    })
    // With an orbit camera the run is a viewer: the view follows it and nothing walks.
    if (orbit) {
      const camera = orbit as OrbitCamera
      camera.enabled = true
      engine.camera.target = camera.camera
      if (physics) physics.paused = false
      return () => {
        camera.enabled = false
        if (physics) physics.paused = true
      }
    }
    // A scene of screen UI alone (a card game, a menu) has nothing to walk in, and a walker would take the pointer.
    let spatial = false
    root.walk((node) => {
      if (spatial || node === root || node instanceof Slate || node instanceof UIElement) return
      if (node instanceof Node3D && node.constructor !== Node3D) spatial = true
    })
    if (!spatial) {
      if (physics) physics.paused = false
      return () => {
        if (physics) physics.paused = true
      }
    }
    let start: Node3D | null = null
    root.walk((node) => {
      if (!start && node instanceof PlayerStart) start = node
    })
    if (!start) root.walk((node) => {
      if (!start && node instanceof Camera) start = node
    })
    const player = engine.add(new FirstPersonController({ speed: 2, sprintSpeed: 4, jumpSpeed: 4, stepHeight: 0.4 }))
    const at = start ? (start as Node3D).getWorldPosition() : new Vector3(0, 0, 3)
    player.transform.position.set(at.x, at.y + 0.85, at.z)
    if (start) player.transform.rotation.copy((start as Node3D).getWorldRotation())
    engine.camera.target = player.camera
    if (physics) physics.paused = false
    return () => {
      player.dispose()
      if (physics) physics.paused = true
    }
  },
}
