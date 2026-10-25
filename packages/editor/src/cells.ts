/** Starting values for cells more than one component declares; one object each, so the declarations agree. */
export const PROJECT_DEFAULT = { open: false, name: null, recipe: "", storage: null, status: "", supported: false, browserStorage: false, dirty: false }
export const VIEW_DEFAULT = { view: "orbit", visualised: true, gizmo: "translate", tool: null as "box" | "collider" | null, vertexEdit: false, editMode: "vertex" as "vertex" | "edge" | "face", physics: false, scripts: false, snap: { enabled: true, move: 0.25, rotate: 15 }, slateEditing: false }
export const HISTORY_DEFAULT = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null }
export const SCRIPTS_DEFAULT: { path: string; name: string }[] = []
import type { StreamableMesh } from "./converter"

/** The make-streamable dialog: closed when `open` is false; `available` once there is a converter to run. */
export const STREAMABLE_DEFAULT = {
  available: false,
  open: false,
  phase: "reading" as "reading" | "choose" | "running" | "done" | "failed",
  source: "",
  out: "",
  meshes: [] as StreamableMesh[],
  mesh: 0,
  stage: "",
  step: 0,
  steps: 0,
  fraction: null as number | null,
  message: "",
  error: "",
  warnings: [] as string[],
  summary: "",
  /** A rebuild's options, as the theca recorded them; null for a new build. */
  rebuild: null as { permissive: boolean; partition: boolean; maxTexture: number; maps: { role: string; path: string }[] } | null,
}

export const PROJECT_DIALOG_DEFAULT = { mode: null as "create" | "edit" | null, name: "untitled", recipe: "scene", description: "", image: null as string | null, location: null as string | null, locations: false, git: false, canGit: false, error: "", taken: "" }
