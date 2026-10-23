import { Camera, Colour, Light, Model, Node3D, type Catalyst, type NodeJSON } from "@nickpaustian/catalyst"
import { pickFile } from "../ProjectFolder"
import { Interactable } from "@nickpaustian/catalyst/interaction"
import { BoxCollider, CapsuleCollider, SphereCollider } from "@nickpaustian/catalyst/physics"
import { Box, Capsule, FirstPersonController, FocalPoint, FocalPointTrigger, PointOfInterest, Sphere } from "@nickpaustian/catalyst/prefabs"
import { Physics } from "@nickpaustian/catalyst/physics"
import { Vector3 } from "@nickpaustian/catalyst"
import type { Recipe } from "../recipe"
import { PlayerStart } from "./playerStart"

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
}

const DEFAULT_ENVIRONMENT: SceneEnvironment = { floor: 0, gravity: 9.8, drag: 0.1, ambient: 0xffffff, ambientIntensity: 0.35, headlight: 0.4 }

const hexOf = (c: Colour): number => (Math.round(c.x) << 16) | (Math.round(c.y) << 8) | Math.round(c.z)
const colourOf = (hex: number): Colour => new Colour((hex >> 16) & 255, (hex >> 8) & 255, hex & 255)

const readEnvironment = (engine: Catalyst): SceneEnvironment => {
  const world = engine.find(Physics)?.world
  const lighting = engine.lighting
  const physics = world ? { floor: world.floor, gravity: world.gravity, drag: world.drag } : DEFAULT_ENVIRONMENT
  return { floor: physics.floor, gravity: physics.gravity, drag: physics.drag, ambient: hexOf(lighting.ambient), ambientIntensity: lighting.ambientIntensity, headlight: lighting.headlight }
}
const applyEnvironment = (engine: Catalyst, environment: Partial<SceneEnvironment> | undefined): void => {
  const next = { ...DEFAULT_ENVIRONMENT, ...environment }
  const world = engine.find(Physics)?.world
  if (world) {
    world.floor = next.floor
    world.gravity = next.gravity
    world.drag = next.drag
  }
  engine.lighting = { ...engine.lighting, ambient: colourOf(next.ambient), ambientIntensity: next.ambientIntensity, headlight: next.headlight }
}

/** The scene file with the environment beside the nodes. */
const toFile = (engine: Catalyst, root: Node3D): NodeJSON & { environment: SceneEnvironment } => ({ ...engine.serialise(root), environment: readEnvironment(engine) })

/** A plain Catalyst scene: a folder holding `scene.json` and whatever it names. */
export const sceneRecipe: Recipe = {
  name: "scene",
  files: [SCENE_FILE],
  kinds: [
    { kind: "Group", label: "Group", cls: Node3D, description: "An empty spatial node: a place to gather other nodes under one transform.", make: ({ name }) => new Node3D(name) },
    { kind: "PlayerStart", label: "Player start", cls: PlayerStart, description: "Where a run puts the player: its position and facing. The first one in the scene is used.", make: (o) => new PlayerStart(o) },
    { kind: "Box", label: "Box", cls: Box, description: "A block with a mesh and a matching collider: floors, walls, crates.", make: (o) => new Box(o) },
    { kind: "Sphere", label: "Sphere", cls: Sphere, description: "A ball with a mesh and a matching collider.", make: (o) => new Sphere(o) },
    { kind: "Capsule", label: "Capsule", cls: Capsule, description: "A pillar or a stand-in body with a mesh and a matching collider.", make: (o) => new Capsule(o) },
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
    { kind: "Camera", label: "Camera", cls: Camera, description: "A perspective camera with a real lens: a focal length over a sensor.", make: (o) => new Camera(o) },
    { kind: "Light", label: "Light", cls: Light, description: "A directional light shining along the node's -z, like the sun: only its rotation matters. With none in the scene the engine's default sun is used.", make: (o) => new Light(o) },
    { kind: "BoxCollider", label: "Box collider", cls: BoxCollider, description: "An invisible box the physics world collides with, or a trigger volume.", make: (o) => new BoxCollider({ ...o, width: 1, height: 1, depth: 1 }) },
    { kind: "SphereCollider", label: "Sphere collider", cls: SphereCollider, description: "An invisible sphere the physics world collides with, or a trigger volume.", make: (o) => new SphereCollider({ ...o, radius: 0.5 }) },
    { kind: "CapsuleCollider", label: "Capsule collider", cls: CapsuleCollider, description: "An invisible capsule the physics world collides with, standing on y.", make: (o) => new CapsuleCollider({ ...o, radius: 0.3, height: 1.8 }) },
    { kind: "Interactable", label: "Interactable", cls: Interactable, description: "Something the pointer or crosshair can land on and click, with focus and interact signals for your code.", make: (o) => new Interactable({ ...o, radius: 0.25 }) },
    { kind: "PointOfInterest", label: "Point of interest", cls: PointOfInterest, description: "An interactable with a marker on screen that fades with distance and hides when something is in the way.", make: (o) => new PointOfInterest(o) },
    { kind: "FocalPoint", label: "Focal point", cls: FocalPoint, description: "Somewhere a guided camera turns to look while it is enabled.", make: (o) => new FocalPoint(o) },
    { kind: "FocalPointTrigger", label: "Trigger", cls: FocalPointTrigger, description: "A box that turns its focal points on while the player is inside it.", make: (o) => new FocalPointTrigger({ ...o, width: 1, height: 2, depth: 1 }) },
  ],
  settings: {
    title: "Environment",
    fields: [
      { key: "floored", label: "Floor", type: "boolean" },
      { key: "floor", label: "Floor height", type: "number", step: 0.1 },
      { key: "gravity", type: "number", min: 0, step: 0.1 },
      { key: "drag", type: "number", min: 0, max: 1, step: 0.01 },
      { key: "ambient", label: "Ambient", type: "colour" },
      { key: "ambientIntensity", label: "Ambient strength", type: "number", min: 0, step: 0.05 },
      { key: "headlight", label: "Headlight", type: "number", min: 0, step: 0.05 },
    ],
    read: (engine) => {
      const environment = readEnvironment(engine)
      return { floored: environment.floor !== null, floor: environment.floor ?? 0, gravity: environment.gravity, drag: environment.drag, ambient: environment.ambient, ambientIntensity: environment.ambientIntensity, headlight: environment.headlight }
    },
    write: (engine, _root, key, value) => {
      const current = readEnvironment(engine)
      if (key === "floored") applyEnvironment(engine, { ...current, floor: value ? (current.floor ?? 0) : null })
      else if (key === "floor") applyEnvironment(engine, { ...current, floor: Number(value) })
      else applyEnvironment(engine, { ...current, [key]: value })
    },
  },
  load: async (folder, engine) => {
    applyEnvironment(engine, undefined)
    if (folder && (await folder.exists(SCENE_FILE))) {
      const json = await folder.readJSON<(NodeJSON & { environment?: Partial<SceneEnvironment> }) | NodeJSON[]>(SCENE_FILE)
      if (Array.isArray(json)) {
        const root = new Node3D("scene")
        for (const entry of json) root.addNode(engine.create(entry))
        return root
      }
      applyEnvironment(engine, json.environment)
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
    applyEnvironment(engine, (scene as { environment?: Partial<SceneEnvironment> }).environment)
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
    const physics = engine.find(Physics)
    if (physics) physics.paused = false
    return () => {
      player.dispose()
      if (physics) physics.paused = true
    }
  },
}
