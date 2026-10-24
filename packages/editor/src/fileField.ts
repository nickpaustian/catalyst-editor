const svg = (paths: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

/** The kinds of file a picker groups its list by, in the order the groups appear. */
const KINDS: { group: string; pattern: RegExp; icon: string }[] = [
  { group: "Environments", pattern: /\.(hdr|exr)$/i, icon: svg('<circle cx="8" cy="8" r="3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>') },
  { group: "Models", pattern: /\.(glb|gltf)$/i, icon: svg('<path d="M2 11.5 8 14.5l6-3V5L8 2 2 5z"/><path d="M2 5l6 3 6-3M8 8v6.5"/>') },
  { group: "Splats", pattern: /\.(ply|sog|spz|splat)$/i, icon: svg('<circle cx="4" cy="5" r="1.4"/><circle cx="9" cy="3.5" r="1.1"/><circle cx="12" cy="7" r="1.6"/><circle cx="6" cy="10" r="1.8"/><circle cx="11" cy="12" r="1.2"/>') },
  { group: "Images", pattern: /\.(png|jpe?g|webp|gif|avif|svg|ktx2)$/i, icon: svg('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="m2.5 11 3.5-3.5 2.5 2.5 2-2 3 3"/><circle cx="10.5" cy="6" r="1"/>') },
  { group: "Prefabs and data", pattern: /\.json$/i, icon: svg('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>') },
  { group: "Scripts", pattern: /\.(ts|js)$/i, icon: svg('<path d="M5.5 5 2.5 8l3 3M10.5 5l3 3-3 3M9 3.5l-2 9"/>') },
  { group: "Audio", pattern: /\.(mp3|ogg|wav|m4a|flac|aac)$/i, icon: svg('<path d="M6 11.5V3.5l7-1.5v8"/><circle cx="4.5" cy="11.5" r="1.5"/><circle cx="11.5" cy="10" r="1.5"/>') },
  { group: "Video", pattern: /\.(mp4|webm|mov)$/i, icon: svg('<rect x="1.5" y="3.5" width="9" height="9" rx="1"/><path d="m10.5 7 4-2.5v7l-4-2.5"/>') },
]
const OTHER = { group: "Other", icon: svg('<path d="M4 1.5h5.5l3 3v10h-8.5z"/><path d="M9.5 1.5v3h3"/>') }

/** What a picker shows a file as: its group and icon. */
export const fileKind = (path: string): { group: string; icon: string } => KINDS.find((kind) => kind.pattern.test(path)) ?? OTHER

/** The order of the groups, for sorting. */
export const groupOrder = (group: string): number => {
  const index = KINDS.findIndex((kind) => kind.group === group)
  return index < 0 ? KINDS.length : index
}

export const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1)

/** What a file field asks the picker for. */
export interface FilePickerRequest {
  /** The field's control: the picker opens under it and gives focus back to it. */
  trigger: HTMLElement
  value: string | null
  /** The project's files the field accepts, by path. */
  choices: string[]
  pick: (path: string | null) => void
  /** Choose a file from disk instead; absent where the field cannot import. */
  importFile?: () => void
}

const CELL = "editor:filePicker"

/** Show the file picker under a field. The FilePicker component, mounted once per page, draws it and closes it. */
export const openFilePicker = (request: FilePickerRequest): void => {
  ;(window as any).lightspeed?.shared(CELL).set(request)
}

export const FILE_PICKER_CELL = CELL

/** The project file being dragged from the files pane, by path, while a drag is on; null otherwise. Drag events only say what they carry on the drop. */
export const DRAGGING_FILE_CELL = "editor:draggingFile"

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
