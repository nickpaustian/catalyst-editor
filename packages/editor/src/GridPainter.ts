import { Grid, type Cell, type Node, type TileType } from "@nickpaustian/catalyst"
import type { EditorCamera, PaintMode, PaintPhase } from "./EditorCamera"

/** The most tile types a grid can hold: one character each in its saved layout. */
const MOST_TILES = 36
const NEW_COLOURS = [0xc9a66b, 0x6b8fc9, 0xc96b7d, 0x8bc96b, 0xa36bc9, 0x6bc9b8]

/** One tile type as the inspector's tiles section lists it. */
export interface GridTileRow {
  index: number
  name: string
  colour: string
  height: number
  tags: string
  cells: number
}

/** The selected grid's palette and the paint tool's state, for the inspector. */
export interface GridPanel {
  painting: boolean
  mode: PaintMode
  /** The tile type painted, or -1 to clear cells. */
  brush: number
  tiles: GridTileRow[]
  empty: number
  canAdd: boolean
}

export type GridCommand =
  | { type: "gridPaint"; on?: boolean }
  | { type: "gridBrush"; index: number }
  | { type: "gridMode"; mode: PaintMode }
  | { type: "gridTile"; index: number; field: "name" | "colour" | "height" | "tags"; value: unknown }
  | { type: "gridTileAdd" }
  | { type: "gridTileRemove"; index: number }

interface GridState {
  columns: number
  rows: number
  tiles: TileType[]
  layout: string[]
}

export interface GridPainterHost {
  readonly camera: EditorCamera
  selected(): Node | null
  record(label: string, undo: () => void, redo: () => void, key?: string): void
  publish(panel: GridPanel | null): void
}

const hex = (colour: number): string => `#${colour.toString(16).padStart(6, "0")}`

/**
 * Painting the selected grid: the brush and how it lays tiles, strokes in the viewport that undo as
 * one step, and the palette's edits. Every change to a grid's shape or palette is kept as a whole
 * snapshot, so undo brings back cells a resize or a removed tile type cleared.
 */
export class GridPainter {
  private brush = 0
  private mode: PaintMode = "brush"
  private grid: Grid | null = null
  private stroke: { grid: Grid; before: GridState } | null = null

  private readonly host: GridPainterHost

  constructor(host: GridPainterHost) {
    this.host = host
    host.camera.onPaint = (cell, phase) => this.paint(cell, phase)
  }

  /** The selection changed: the panel follows it, and painting stops on a grid no longer selected. */
  follow(): void {
    const node = this.host.selected()
    this.grid = node instanceof Grid ? node : null
    if (this.host.camera.paintTarget && this.host.camera.paintTarget !== this.grid) this.host.camera.paintTarget = null
    this.publish()
  }

  publish(): void {
    const grid = this.grid
    if (!grid) return this.host.publish(null)
    const counts = new Array<number>(grid.tiles.length).fill(0)
    let empty = 0
    for (const line of grid.layout) for (const character of line) {
      const index = character === "." ? -1 : parseInt(character, 36)
      if (index >= 0 && index < counts.length) counts[index]++
      else empty++
    }
    this.brush = Math.min(this.brush, grid.tiles.length - 1)
    this.host.publish({
      painting: this.host.camera.paintTarget === grid,
      mode: this.mode,
      brush: this.brush,
      tiles: grid.tiles.map((tile, index) => ({ index, name: tile.name, colour: hex(tile.colour), height: tile.height ?? 0, tags: (tile.tags ?? []).join(", "), cells: counts[index] })),
      empty,
      canAdd: grid.tiles.length < MOST_TILES,
    })
  }

  /** Handles the grid commands; false for any other. */
  command(command: { type: string }): boolean {
    const grid = this.grid
    const c = command as GridCommand
    switch (c.type) {
      case "gridPaint":
        if (grid) this.host.camera.paintTarget = (c.on ?? this.host.camera.paintTarget !== grid) ? grid : null
        break
      case "gridBrush":
        this.brush = c.index
        if (grid) this.host.camera.paintTarget = grid
        break
      case "gridMode":
        this.mode = c.mode
        if (grid) this.host.camera.paintTarget = grid
        break
      case "gridTile":
        if (grid) this.editTile(grid, c.index, c.field, c.value)
        break
      case "gridTileAdd":
        if (grid && grid.tiles.length < MOST_TILES) {
          const colour = NEW_COLOURS[grid.tiles.length % NEW_COLOURS.length]
          this.change("add tile type", grid, () => (grid.tiles = [...grid.tiles, { name: `tile ${grid.tiles.length + 1}`, colour, height: 0, tags: [] }]))
          this.brush = grid.tiles.length - 1
        }
        break
      case "gridTileRemove":
        if (grid) this.removeTile(grid, c.index)
        break
      default:
        return false
    }
    this.publish()
    return true
  }

  /** Run `edit` on the grid as one undo step, kept whole: its size, palette and cells before and after. */
  change(label: string, grid: Grid, edit: () => void, key?: string): void {
    const before = snapshot(grid)
    edit()
    this.keep(label, grid, before, key)
  }

  private keep(label: string, grid: Grid, before: GridState, key?: string): void {
    const after = snapshot(grid)
    if (JSON.stringify(before) === JSON.stringify(after)) return
    this.host.record(label, () => this.restore(grid, before), () => this.restore(grid, after), key)
  }

  private restore(grid: Grid, state: GridState): void {
    grid.resize(state.columns, state.rows)
    grid.tiles = state.tiles
    grid.layout = state.layout
    this.publish()
  }

  private paint(cell: Cell | null, phase: PaintPhase): void {
    if (phase === "begin" && cell) {
      const grid = this.host.camera.paintTarget
      if (!grid) return
      this.stroke = { grid, before: snapshot(grid) }
      if (this.mode === "fill") grid.paint(floodFrom(grid, cell), this.brush)
      else grid.paint(cell, this.brush)
      return
    }
    const stroke = this.stroke
    if (!stroke) return
    if (phase === "move" && cell) {
      if (this.mode === "brush") stroke.grid.paint(cell, this.brush)
      return
    }
    this.stroke = null
    this.keep(this.mode === "fill" ? "fill tiles" : "paint tiles", stroke.grid, stroke.before)
    this.publish()
  }

  private editTile(grid: Grid, index: number, field: "name" | "colour" | "height" | "tags", value: unknown): void {
    const tile = grid.tiles[index]
    if (!tile) return
    const next: TileType = { ...tile, tags: [...(tile.tags ?? [])] }
    if (field === "name") {
      const name = String(value).trim()
      if (!name) return
      next.name = name
    } else if (field === "colour") {
      const colour = parseInt(String(value).replace("#", ""), 16)
      if (!Number.isFinite(colour)) return
      next.colour = colour
    } else if (field === "height") {
      const height = Number(value)
      if (!Number.isFinite(height)) return
      next.height = Math.max(0, height)
    } else {
      next.tags = [...new Set(String(value).split(/[\s,]+/).filter(Boolean))]
    }
    this.change(`tile ${field}`, grid, () => (grid.tiles = grid.tiles.map((t, i) => (i === index ? next : t))), `grid:${field}:${index}`)
  }

  /** The type goes, its cells are cleared, and the types after it move down one so their cells keep them. */
  private removeTile(grid: Grid, index: number): void {
    if (!grid.tiles[index]) return
    const layout = grid.layout.map((line) =>
      [...line].map((character) => {
        if (character === ".") return character
        const at = parseInt(character, 36)
        return at === index ? "." : at > index ? (at - 1).toString(36) : character
      }).join(""),
    )
    this.change(`remove ${grid.tiles[index].name}`, grid, () => {
      grid.tiles = grid.tiles.filter((_, i) => i !== index)
      grid.layout = layout
    })
    if (this.brush > index) this.brush--
  }
}

const snapshot = (grid: Grid): GridState => ({ columns: grid.columns, rows: grid.rows, tiles: grid.tiles.map((tile) => ({ ...tile, tags: [...(tile.tags ?? [])] })), layout: grid.layout })

/** The cells joined to `start` side by side that hold the same tile type it does. */
const floodFrom = (grid: Grid, start: Cell): Cell[] => {
  const index = grid.indexAt(start)
  const seen = new Set<number>([start.row * grid.columns + start.column])
  const found: Cell[] = [start]
  for (let i = 0; i < found.length; i++) {
    for (const next of grid.neighbours(found[i])) {
      const key = next.row * grid.columns + next.column
      if (seen.has(key) || grid.indexAt(next) !== index) continue
      seen.add(key)
      found.push(next)
    }
  }
  return found
}
