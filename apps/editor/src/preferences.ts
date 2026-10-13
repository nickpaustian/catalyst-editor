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

export const PANEL_WIDTH = { min: 240, max: 800, initial: 320 }

const panelWidth = new Preference<number>({
  key: "panelWidth",
  initial: PANEL_WIDTH.initial,
  onChange: (width) =>
    document.documentElement.style.setProperty("--editor-panel-width", `${width}px`),
})

const clampPanelWidth = (width: number): number =>
  Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, width)))

export const preferences = {
  get panelWidth(): number {
    return panelWidth.value
  },
  setPanelWidth: (width: number) => panelWidth.set(clampPanelWidth(width)),
  resetPanelWidth: panelWidth.reset,

  init: () => {
    panelWidth.init()
    publish()
  },
}

const snapshot = () => ({ panelWidth: panelWidth.value })

function publish(): void {
  window.lightspeed?.shared(CELL).set(snapshot())
}
