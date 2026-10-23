import type { FolderSource, ProjectFolder } from "./ProjectFolder"

/** The extension of a project's own file, `<name>.catalyst`: its settings, and what opens the project from outside. */
export const PROJECT_EXTENSION = ".catalyst"
/** The older settings file, still read. */
export const LEGACY_PROJECT_FILE = "project.json"

/** What the project file holds: the project as the editor and a player describe it, apart from its scene. */
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

/** The project's file in a folder: the first `.catalyst` at the root, else `project.json` from before, else null. */
export const projectFileOf = async (folder: ProjectFolder): Promise<string | null> => {
  const entries = await folder.list()
  const own = entries.find((entry) => entry.kind === "file" && entry.name.endsWith(PROJECT_EXTENSION))
  if (own) return own.path
  return (await folder.exists(LEGACY_PROJECT_FILE)) ? LEGACY_PROJECT_FILE : null
}

export const readProjectSettings = async (folder: ProjectFolder): Promise<ProjectSettings | null> => {
  const file = await projectFileOf(folder)
  if (!file) return null
  try {
    const json = await folder.readJSON<Partial<ProjectSettings>>(file)
    return { name: String(json.name ?? folder.name), recipe: String(json.recipe ?? "scene"), description: String(json.description ?? ""), created: json.created }
  } catch {
    return null
  }
}

/** Write the settings to the project's file: the one it has, or a new `<name>.catalyst`. */
export const writeProjectSettings = async (folder: ProjectFolder, settings: ProjectSettings): Promise<string> => {
  const file = (await projectFileOf(folder)) ?? `${slug(settings.name)}${PROJECT_EXTENSION}`
  await folder.writeJSON(file, settings)
  return file
}

/** Make the project's folder (named after the project under `location`, or in the browser) and its `<name>.catalyst`. */
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

/** The folder a `.catalyst` file's project lives in. */
export const projectFolderOfFile = (path: string): string => path.replace(/[\\/][^\\/]*$/, "")
