import type { FolderSource, ProjectFolder } from "./ProjectFolder"

export const PROJECT_FILE = "project.json"

/** What `project.json` holds: the project as the editor and a player describe it, apart from its scene. */
export interface ProjectSettings {
  name: string
  recipe: string
  description: string
  /** ISO date of creation. */
  created?: string
}

/** The fields the new-project dialog collects. */
export interface NewProject {
  name: string
  recipe: string
  description: string
  /** Where the project folder is made, where projects are folders; null in the browser. */
  location: string | null
  /** Start a git repository in the folder, where the shell can. */
  git?: boolean
}

export const GITIGNORE = `node_modules/
.DS_Store
`

export const slug = (name: string): string => name.trim().toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "project"

export const readProjectSettings = async (folder: ProjectFolder): Promise<ProjectSettings | null> => {
  if (!(await folder.exists(PROJECT_FILE))) return null
  try {
    const json = await folder.readJSON<Partial<ProjectSettings>>(PROJECT_FILE)
    return { name: String(json.name ?? folder.name), recipe: String(json.recipe ?? "scene"), description: String(json.description ?? ""), created: json.created }
  } catch {
    return null
  }
}

export const writeProjectSettings = (folder: ProjectFolder, settings: ProjectSettings): Promise<void> => folder.writeJSON(PROJECT_FILE, settings)

/** Make the project's folder (named after the project under `location`, or in the browser) and its `project.json`. */
export const createProject = async (folders: FolderSource, fields: NewProject): Promise<ProjectFolder> => {
  const name = fields.name.trim() || "untitled"
  const folder = await folders.create(name, fields.location)
  await writeProjectSettings(folder, { name, recipe: fields.recipe || "scene", description: fields.description.trim(), created: new Date().toISOString() })
  if (fields.git && folders.canInitGit) {
    if (!(await folder.exists(".gitignore"))) await folder.writeText(".gitignore", GITIGNORE)
    await folders.initGit(folder)
  }
  return folder
}
