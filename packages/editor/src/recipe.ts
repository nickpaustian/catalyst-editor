import type { Catalyst, Module, Node3D } from "@nickpaustian/catalyst"
import type { ProjectFolder } from "./ProjectFolder"

/** Something the tree can add: a label, and how to make one. */
export interface NodeKind {
  kind: string
  label: string
  /** The class, for its icon. */
  cls: object
  make: (options: { name: string; visualise: boolean }) => Node3D
}

/**
 * What a project is: the modules its nodes need, the kinds of node it adds,
 * the panel sections it shows, and how its folder becomes a scene root and
 * back. The editor's own parts (tree, fields, gizmo, folder) are the same
 * for every recipe.
 */
export interface Recipe {
  name: string
  /** Modules installed on the editor's engine, beyond the core set. */
  modules?: () => Module[]
  kinds: NodeKind[]
  /** Lightspeed component ids mounted in the panel after the scene sections. */
  panel?: string[]
  /** Read the folder into a scene root. A folder without a project in it gets a fresh one. */
  load: (folder: ProjectFolder | null, engine: Catalyst) => Promise<Node3D>
  /** Write the project to the folder; the paths written come back for the status line. */
  save: (folder: ProjectFolder, root: Node3D, engine: Catalyst) => Promise<string[]>
  /** The one file to offer as a download when there is no folder to write to. */
  download?: (root: Node3D, engine: Catalyst) => { name: string; text: string }
}
