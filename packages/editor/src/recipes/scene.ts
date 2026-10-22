import { Camera, Node3D, type NodeJSON } from "@nickpaustian/catalyst"
import { Interactable } from "@nickpaustian/catalyst/interaction"
import { BoxCollider, CapsuleCollider, SphereCollider } from "@nickpaustian/catalyst/physics"
import { Box, Capsule, FirstPersonController, FocalPoint, FocalPointTrigger, PointOfInterest, Sphere } from "@nickpaustian/catalyst/prefabs"
import { Physics } from "@nickpaustian/catalyst/physics"
import { Vector3 } from "three"
import type { Recipe } from "../recipe"
import { PlayerStart } from "./playerStart"

export const SCENE_FILE = "scene.json"

/** A plain Catalyst scene: a folder holding `scene.json` and whatever it names. */
export const sceneRecipe: Recipe = {
  name: "scene",
  kinds: [
    { kind: "Group", label: "Group", cls: Node3D, make: ({ name }) => new Node3D(name) },
    { kind: "PlayerStart", label: "Player start", cls: PlayerStart, make: (o) => new PlayerStart(o) },
    { kind: "Box", label: "Box", cls: Box, make: (o) => new Box(o) },
    { kind: "Sphere", label: "Sphere", cls: Sphere, make: (o) => new Sphere(o) },
    { kind: "Capsule", label: "Capsule", cls: Capsule, make: (o) => new Capsule(o) },
    { kind: "Camera", label: "Camera", cls: Camera, make: (o) => new Camera(o) },
    { kind: "BoxCollider", label: "Box collider", cls: BoxCollider, make: (o) => new BoxCollider({ ...o, width: 1, height: 1, depth: 1 }) },
    { kind: "SphereCollider", label: "Sphere collider", cls: SphereCollider, make: (o) => new SphereCollider({ ...o, radius: 0.5 }) },
    { kind: "CapsuleCollider", label: "Capsule collider", cls: CapsuleCollider, make: (o) => new CapsuleCollider({ ...o, radius: 0.3, height: 1.8 }) },
    { kind: "Interactable", label: "Interactable", cls: Interactable, make: (o) => new Interactable({ ...o, radius: 0.25 }) },
    { kind: "PointOfInterest", label: "Point of interest", cls: PointOfInterest, make: (o) => new PointOfInterest(o) },
    { kind: "FocalPoint", label: "Focal point", cls: FocalPoint, make: (o) => new FocalPoint(o) },
    { kind: "FocalPointTrigger", label: "Trigger", cls: FocalPointTrigger, make: (o) => new FocalPointTrigger({ ...o, width: 1, height: 2, depth: 1 }) },
  ],
  load: async (folder, engine) => {
    if (folder && (await folder.exists(SCENE_FILE))) {
      const json = await folder.readJSON<NodeJSON | NodeJSON[]>(SCENE_FILE)
      if (Array.isArray(json)) {
        const root = new Node3D("scene")
        for (const entry of json) root.addNode(engine.create(entry))
        return root
      }
      const root = engine.create(json)
      if (root instanceof Node3D) return root
      const wrapped = new Node3D("scene")
      wrapped.addNode(root)
      return wrapped
    }
    return new Node3D("scene")
  },
  save: async (folder, root, engine) => {
    await folder.writeJSON(SCENE_FILE, engine.serialise(root))
    return [SCENE_FILE]
  },
  download: (root, engine) => ({ name: SCENE_FILE, text: JSON.stringify(engine.serialise(root), null, 2) + "\n" }),
  run: async ({ engine, root }) => {
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
