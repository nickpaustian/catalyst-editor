export interface HistoryEntry {
  label: string
  undo: () => void
  redo: () => void
  /** Entries sharing a key within `coalesceMs` of each other merge: a scrub is one change. */
  key?: string
}

interface Kept extends HistoryEntry {
  at: number
}

/**
 * Undo and redo over entries that know how to reverse and repeat
 * themselves. A new entry after some undos discards what was undone. The
 * saved mark says whether the project differs from what is on disk.
 */
export class History {
  private entries: Kept[] = []
  private index = 0
  private savedIndex = 0
  private readonly coalesceMs: number
  private readonly limit: number
  onChange: (() => void) | null = null

  constructor(options: { coalesceMs?: number; limit?: number } = {}) {
    this.coalesceMs = options.coalesceMs ?? 600
    this.limit = options.limit ?? 200
  }

  /** Record a change that has already been applied. */
  push(entry: HistoryEntry): void {
    const now = performance.now()
    const last = this.entries[this.index - 1]
    if (entry.key && last && last.key === entry.key && now - last.at < this.coalesceMs && this.index === this.entries.length) {
      last.redo = entry.redo
      last.at = now
      this.onChange?.()
      return
    }
    this.entries.length = this.index
    if (this.savedIndex > this.index) this.savedIndex = -1
    this.entries.push({ ...entry, at: now })
    if (this.entries.length > this.limit) {
      this.entries.shift()
      this.savedIndex--
    }
    this.index = this.entries.length
    this.onChange?.()
  }

  undo(): boolean {
    if (this.index === 0) return false
    this.index--
    this.entries[this.index].undo()
    this.onChange?.()
    return true
  }

  redo(): boolean {
    if (this.index >= this.entries.length) return false
    this.entries[this.index].redo()
    this.index++
    this.onChange?.()
    return true
  }

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.entries.length
  }

  get undoLabel(): string | null {
    return this.entries[this.index - 1]?.label ?? null
  }

  get redoLabel(): string | null {
    return this.entries[this.index]?.label ?? null
  }

  /** The project now matches what is saved. */
  markSaved(): void {
    this.savedIndex = this.index
    this.onChange?.()
  }

  /** The project differs from what is saved, with no change to undo back to it: unsaved work restored. */
  markUnsaved(): void {
    this.savedIndex = -1
    this.onChange?.()
  }

  get isDirty(): boolean {
    return this.index !== this.savedIndex
  }

  clear(): void {
    this.entries = []
    this.index = 0
    this.savedIndex = 0
    this.onChange?.()
  }
}
