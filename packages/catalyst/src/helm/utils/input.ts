export const MOUSE_BUTTON_ALIASES: Record<string, string> = {
  "mouse:left": "mouse:1",
  "mouse:right": "mouse:2",
  "mouse:middle": "mouse:3",
}

export function normaliseKey(key: string): string {
  const lower = key.toLowerCase()

  // Pointer button codes use a "mouse:" prefix and resolve to canonical form.
  if (lower.startsWith("mouse:")) {
    return MOUSE_BUTTON_ALIASES[lower] ?? lower
  }

  // Convert single letter keys to lowercase for consistent storage
  if (key.length === 1 && key.match(/[a-zA-Z]/)) {
    return key.toLowerCase()
  }
  return key
}

const KEY_GROUPS: Record<string, string[]> = {
  numbers: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  arrows: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"],
  wasd: ["w", "a", "s", "d"],
  fkeys: [
    "F1",
    "F2",
    "F3",
    "F4",
    "F5",
    "F6",
    "F7",
    "F8",
    "F9",
    "F10",
    "F11",
    "F12",
  ],
  mouse: ["mouse:1", "mouse:2", "mouse:3", "mouse:4", "mouse:5"],
}

export function resolveKeys(keys: string | string[]): string[] {
  const keyArray = Array.isArray(keys) ? keys : [keys]
  return keyArray.flatMap((key) => {
    const group = KEY_GROUPS[key.toLowerCase()]
    return group ?? [key]
  })
}

export function isKeyGroup(key: string): boolean {
  return key.toLowerCase() in KEY_GROUPS
}

export function getGroupKeyIndex(groupName: string, key: string): number {
  const group = KEY_GROUPS[groupName.toLowerCase()]
  if (!group) return -1
  return group.indexOf(key)
}

export function resolveTarget(
  target?: HTMLElement | string | null
): HTMLElement | Document {
  if (!target) return document
  if (typeof target === "string") {
    const el = document.querySelector<HTMLElement>(target)
    if (!el) throw new Error(`[MouseManager] Element not found: ${target}`)
    return el
  }
  return target
}
