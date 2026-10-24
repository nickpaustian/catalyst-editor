/** The value of the choice in a file field's list that imports a file from disk instead of naming one. */
export const IMPORT_CHOICE = "catalyst:import"

export interface FileChoice {
  path: string
  label: string
}

/** A file field's list: the project's files it accepts, and the current value too when no file answers to it. */
export const fileChoices = (choices: string[] | undefined, value: unknown): FileChoice[] => {
  const paths = [...(choices ?? [])]
  const current = typeof value === "string" && value ? value : null
  const list = paths.map((path) => ({ path, label: path }))
  if (current && !paths.includes(current)) list.unshift({ path: current, label: `${current} (missing)` })
  return list
}

const MEDIA_EXTENSIONS: Record<string, string[]> = {
  image: [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg", ".ktx2"],
  audio: [".mp3", ".ogg", ".wav", ".m4a", ".flac", ".aac"],
  video: [".mp4", ".webm", ".mov"],
  model: [".glb", ".gltf"],
}

/** The extensions an input's `accept` takes (`.hdr`, or media types such as `image/*` by their usual extensions); null when it takes any file. */
export const acceptedExtensions = (accept: string | undefined): string[] | null => {
  const kinds = (accept ?? "").split(",").map((kind) => kind.trim().toLowerCase()).filter(Boolean)
  if (!kinds.length) return null
  return [...new Set(kinds.flatMap((kind) => (kind.startsWith(".") ? [kind] : MEDIA_EXTENSIONS[kind.split("/")[0]] ?? [])))]
}

/** Whether a path matches an input's `accept`; no accept takes any file. */
export const accepts = (accept: string | undefined, path: string): boolean => {
  const extensions = acceptedExtensions(accept)
  return !extensions || extensions.includes(path.slice(path.lastIndexOf(".")).toLowerCase())
}
