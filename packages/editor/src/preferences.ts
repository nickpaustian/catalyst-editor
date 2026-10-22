/**
 * Editor preferences: small, per-browser settings kept in localStorage.
 * Modelled on the copyright-free viewer's Preference store; here reactivity is
 * the `editor:preferences` shared cell, which carries every current value.
 */
const PREFIX = "vitrine-editor:"
const CELL = "editor:preferences"

const storage = {
  get: <T>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(`${PREFIX}${key}`)
      return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
      return fallback
    }
  },
  set: <T>(key: string, value: T): void => {
    try {
      localStorage.setItem(`${PREFIX}${key}`, JSON.stringify(value))
    } catch {}
  },
  remove: (key: string): void => {
    try {
      localStorage.removeItem(`${PREFIX}${key}`)
    } catch {}
  },
}

export interface PreferenceOptions<T> {
  key: string
  initial: T
  fallback?: T | (() => T)
  onChange?: (value: T) => void
}

export class Preference<T> {
  private readonly key: string
  private readonly fallback: () => T
  private readonly onChange?: (value: T) => void
  private current: T

  constructor({ key, initial, fallback, onChange }: PreferenceOptions<T>) {
    this.key = key
    this.onChange = onChange
    this.current = initial
    this.fallback =
      typeof fallback === "function"
        ? (fallback as () => T)
        : () => (fallback === undefined ? initial : fallback)
  }

  get value(): T {
    return this.current
  }

  set = (next: T): void => {
    this.current = next
    storage.set(this.key, next)
    this.onChange?.(next)
    publish()
  }

  init = (): void => {
    this.current = storage.get(this.key, this.fallback())
    this.onChange?.(this.current)
  }

  reset = (): void => {
    storage.remove(this.key)
    this.current = this.fallback()
    this.onChange?.(this.current)
    publish()
  }
}

import { isValidLayout, pane, split, type LayoutNode, type PaneKind } from "./panes/layout"

export const PANE_KINDS: PaneKind[] = ["viewport", "panel"]

export const defaultLayout = (): LayoutNode =>
  split("row", [pane("viewport"), pane("panel")], [0.75, 0.25])

const layout = new Preference<LayoutNode>({
  key: "layout",
  initial: defaultLayout(),
  fallback: defaultLayout,
})

export const preferences = {
  /** The pane tree; a stored tree that no longer fits the known kinds falls back to the default. */
  get layout(): LayoutNode {
    return isValidLayout(layout.value, PANE_KINDS) ? layout.value : defaultLayout()
  },
  setLayout: layout.set,
  resetLayout: layout.reset,

  init: () => {
    layout.init()
    publish()
  },
}

const snapshot = () => ({ layout: layout.value })

function publish(): void {
  ;(window as any).lightspeed?.shared(CELL).set(snapshot())
}
