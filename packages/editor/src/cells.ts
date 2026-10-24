/** Starting values for cells more than one component declares; one object each, so the declarations agree. */
export const PROJECT_DEFAULT = { open: false, name: null, recipe: "", storage: null, status: "", supported: false, browserStorage: false, dirty: false }
export const VIEW_DEFAULT = { view: "orbit", visualised: true, gizmo: "translate", physics: false, scripts: false, snap: { enabled: true, move: 0.25, rotate: 15 } }
export const HISTORY_DEFAULT = { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null }
export const SCRIPTS_DEFAULT: { path: string; name: string }[] = []
export const PROJECT_DIALOG_DEFAULT = { mode: null as "create" | "edit" | null, name: "untitled", recipe: "scene", description: "", image: null as string | null, location: null as string | null, locations: false, git: false, canGit: false, error: "", taken: "" }
