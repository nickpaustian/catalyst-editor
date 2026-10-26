/**
 * Editor preferences: small, per-browser settings kept in localStorage.
 * Modelled on the copyright-free viewer's Preference store; here reactivity is
 * the `editor:preferences` shared cell, which carries every current value.
 */
const PREFIX = "catalyst-editor:"
const CELL = "editor:preferences"

export const storage = {
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

import { defaultStreamingQuality, type StreamingQuality } from "@nickpaustian/catalyst"
import { addTabs, emptyFloating, isSingleKindLayout, isValidFloating, isValidLayout, leafOf, pane, split, upgradeLayout, type FloatingState, type LayoutNode, type PaneKind } from "./panes/layout"

export const PANE_KINDS: PaneKind[] = ["scene", "viewport", "inspector", "environment", "code", "files", "preview", "signals"]

/** Scene on the left, inspector on the right, the viewport between, as Godot lays it out. */
export const defaultLayout = (): LayoutNode =>
  split("row", [split("column", [pane("scene"), pane("files")], [0.6, 0.4]), pane("viewport"), pane("inspector", "environment")], [0.18, 0.6, 0.22])

/** A tree saved before tabs had the environment inside the inspector, so it joins the inspector as a tab. */
const storedLayout = (value: unknown): unknown => {
  if (!isSingleKindLayout(value)) return value
  const upgraded = upgradeLayout(value) as LayoutNode
  const inspector = isValidLayout(upgraded, PANE_KINDS) ? leafOf(upgraded, "inspector") : null
  return inspector ? addTabs(upgraded, inspector.id, ["environment"], inspector.active) : upgraded
}

const layout = new Preference<LayoutNode>({
  key: "layout-v2",
  initial: defaultLayout(),
  fallback: defaultLayout,
})

const floating = new Preference<FloatingState>({
  key: "floating-v1",
  initial: emptyFloating(),
  fallback: emptyFloating,
})

export interface SnapSettings {
  enabled: boolean
  /** World units between positions. */
  move: number
  /** Degrees between angles. */
  rotate: number
}

const snap = new Preference<SnapSettings>({
  key: "snap",
  initial: { enabled: true, move: 0.25, rotate: 15 },
})

/** How much detail streamed surfaces load in the editor's viewport; a run uses the scene's own settings. */
export type StreamingPreset = "full" | "balanced" | "fast"
export const STREAMING_PRESETS: StreamingPreset[] = ["full", "balanced", "fast"]
export const streamingQualityOf = (preset: StreamingPreset): StreamingQuality =>
  preset === "fast"
    ? { pixelError: 6, geometryDetailCap: 1, textureDetailCap: 2, textureLodBias: 0.5 }
    : preset === "balanced"
      ? { pixelError: 3, geometryDetailCap: 0, textureDetailCap: 1, textureLodBias: 0 }
      : defaultStreamingQuality()

const streaming = new Preference<StreamingPreset>({
  key: "streaming",
  initial: "balanced",
})

export const preferences = {
  get snap(): SnapSettings {
    return snap.value
  },
  setSnap: snap.set,

  get streaming(): StreamingPreset {
    return STREAMING_PRESETS.includes(streaming.value) ? streaming.value : "balanced"
  },
  setStreaming: streaming.set,

  /** The pane tree; a stored tree that no longer fits the known kinds falls back to the default. */
  get layout(): LayoutNode {
    const stored = storedLayout(layout.value)
    return isValidLayout(stored, PANE_KINDS) ? stored : defaultLayout()
  },
  setLayout: layout.set,
  resetLayout: layout.reset,

  /** The floating windows; any that no longer fit the known kinds, or hold a kind the tree also has, are dropped. */
  get floating(): FloatingState {
    const tree = preferences.layout
    const stored: unknown = floating.value
    if (isValidFloating(stored, PANE_KINDS, tree)) return stored
    // The windows are dropped, but where each kind's window was is kept when it still reads.
    const rects = (stored as Partial<FloatingState> | null)?.rects
    const kept = { panes: [], rects }
    return isValidFloating(kept, PANE_KINDS, tree) ? kept : emptyFloating()
  },
  setFloating: floating.set,
  resetFloating: floating.reset,

  init: () => {
    layout.init()
    floating.init()
    snap.init()
    streaming.init()
    publish()
  },
}

const snapshot = () => ({ layout: layout.value, snap: snap.value })

function publish(): void {
  ;(window as any).lightspeed?.shared(CELL).set(snapshot())
}
