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
