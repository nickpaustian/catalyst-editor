import type { Catalyst, ExposedProperty, Module, Node3D, NodeJSON } from "@nickpaustian/catalyst"
import type { ProjectFolder } from "./ProjectFolder"

export interface RunContext {
  engine: Catalyst
  root: Node3D
  /** The scene as it was sent, for anything the recipe keeps beside the nodes. */
  scene: NodeJSON
  folder: ProjectFolder | null
}

/**
 * Project-wide settings a recipe keeps beside the node tree: the physics
 * floor, gravity, a sky. Shown in the panel as fields, read and written
 * through the recipe, saved however the recipe saves.
 */
export interface RecipeSettings {
  title: string
  fields: ExposedProperty[]
  read: (engine: Catalyst, root: Node3D) => Record<string, unknown>
  write: (engine: Catalyst, root: Node3D, key: string, value: unknown) => void
}

/** Something the tree can add: a label, and how to make one. */
export interface NodeKind {
  kind: string
  label: string
  /** The class: its icon, and its place in the hierarchy the add dialog shows. */
  cls: object
  /** A sentence for the add dialog. */
  description?: string
  /** Asked before `make`, for a kind that needs a file: import it into the project and give back the options; null cancels. */
  pick?: (folder: ProjectFolder) => Promise<Record<string, unknown> | null>
  make: (options: { name: string; visualise: boolean } & Record<string, unknown>) => Node3D
}

/**
 * What a project is: the modules its nodes need, the kinds of node it adds,
 * the panel sections it shows, and how its folder becomes a scene root and
 * back. The editor's own parts (tree, fields, gizmo, folder) are the same
 * for every recipe.
 */
export interface Recipe {
  name: string
  /** The project files the recipe writes (`scene.json`): a change to one on disk means the project should reload. */
  files?: string[]
  /** Modules installed on the editor's engine, beyond the core set. */
  modules?: () => Module[]
  kinds: NodeKind[]
  /** Lightspeed component ids mounted in the panel after the scene sections. */
  panel?: string[]
  settings?: RecipeSettings
  /** Read the folder into a scene root. A folder without a project in it gets a fresh one. */
  load: (folder: ProjectFolder | null, engine: Catalyst) => Promise<Node3D>
  /** Write the project to the folder; the paths written come back for the status line. */
  save: (folder: ProjectFolder, root: Node3D, engine: Catalyst) => Promise<string[]>
  /** The project as one JSON document: the node tree plus whatever the recipe keeps beside it. What a run is sent. Default `engine.serialise(root)`. */
  serialise?: (root: Node3D, engine: Catalyst) => NodeJSON
  /** The one file to offer as a download when there is no folder to write to. */
  download?: (root: Node3D, engine: Catalyst) => { name: string; text: string }
  /** Play the project in the runner: put a player in, let physics go. Returns the teardown. */
  run: (context: RunContext) => Promise<() => void>
}
