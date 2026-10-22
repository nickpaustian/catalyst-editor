<view>
<section class="tree">
  <h2 class="heading">Scene</h2>
  <div class="adders">
    <button $for="kind in shared['editor:kinds']" $key="kind.kind" @click="add(kind.kind)">
      <span class="icon" $html="kind.icon"></span>{{ kind.label }}
    </button>
  </div>
  <p class="hint">
    New nodes go under the selected node. Shift-click selects a range, ctrl- or cmd-click adds
    or removes one. Drag a row onto another: its top edge puts it before, its bottom edge after,
    the middle makes it a child. World position is kept.
  </p>
  <div class="rows">
    <div
      class="row"
      $for="row in shared['editor:tree']"
      $key="row.id"
      $class="{ selected: row.selected, active: row.active, root: row.isRoot }"
      @pointerdown="press($event, row)"
      @click="select($event, row)"
    >
      <span class="indent" $for="n in row.depth" $key="n"></span>
      <span class="twisty" $class="{ hidden: !row.hasChildren, open: row.expanded }" @click="toggle($event, row)">▸</span>
      <span class="icon" $html="row.icon"></span>
      <span class="name">{{ row.name }}</span>
      <span class="type">{{ row.type }}</span>
    </div>
  </div>
</section>
</view>

<logic lang="ts">
import { shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

interface Row { id: number; name: string; type: string; icon: string; depth: number; hasChildren: boolean; expanded: boolean; selected: boolean; active: boolean; isRoot: boolean }
type Place = 'before' | 'after' | 'inside'

shared('editor:tree', [])
shared('editor:kinds', [])

const DRAG_THRESHOLD = 4
let drag: { ids: number[]; startX: number; startY: number; list: HTMLElement; active: boolean } | null = null
let dropTarget: { id: number; place: Place; element: HTMLElement } | null = null
let justDragged = false

function add(kind: string) {
  sendCommand({ type: 'add', kind })
}

function select(event: MouseEvent, row: Row) {
  if (justDragged) {
    justDragged = false
    return
  }
  const mode = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace'
  sendCommand({ type: 'select', id: row.id, mode })
}

// Dragging a selected row carries the whole selection; any other row moves alone
function draggedIds(row: Row): number[] {
  const rows = shared('editor:tree').value as Row[]
  return row.selected ? rows.filter((r) => r.selected && !r.isRoot).map((r) => r.id) : [row.id]
}

function toggle(event: Event, row: Row) {
  event.stopPropagation()
  sendCommand({ type: 'toggleExpand', id: row.id })
}

// Rows are rendered in the same order as the cell, so a row element maps
// back to its data by position
function rowAt(list: HTMLElement, x: number, y: number): { row: Row; element: HTMLElement } | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('.row')
  if (!element || !list.contains(element)) return null
  const elements = Array.from(list.querySelectorAll<HTMLElement>('.row'))
  const row = (shared('editor:tree').value as Row[])[elements.indexOf(element)]
  return row ? { row, element } : null
}

function placeFor(element: HTMLElement, y: number): Place {
  const rect = element.getBoundingClientRect()
  const fraction = (y - rect.top) / rect.height
  if (fraction < 0.25) return 'before'
  if (fraction > 0.75) return 'after'
  return 'inside'
}

function clearDrop() {
  dropTarget?.element.classList.remove('drop-before', 'drop-after', 'drop-inside')
  dropTarget = null
}

function press(event: PointerEvent, row: Row) {
  if (row.isRoot || (event.target as HTMLElement).closest('.twisty')) return
  const list = (event.currentTarget as HTMLElement).closest<HTMLElement>('.rows')
  if (!list) return
  drag = { ids: draggedIds(row), startX: event.clientX, startY: event.clientY, list, active: false }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', release)
}

function move(event: PointerEvent) {
  if (!drag) return
  if (!drag.active) {
    if (Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD && Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD) return
    drag.active = true
    document.body.classList.add('tree-dragging')
  }
  const hit = rowAt(drag.list, event.clientX, event.clientY)
  if (!hit || drag.ids.includes(hit.row.id) || hit.row.isRoot && placeFor(hit.element, event.clientY) !== 'inside') {
    clearDrop()
    return
  }
  const place = placeFor(hit.element, event.clientY)
  if (dropTarget?.id === hit.row.id && dropTarget.place === place) return
  clearDrop()
  hit.element.classList.add(`drop-${place}`)
  dropTarget = { id: hit.row.id, place, element: hit.element }
}

function release() {
  document.removeEventListener('pointermove', move)
  document.removeEventListener('pointerup', release)
  document.body.classList.remove('tree-dragging')
  const moved = drag?.active ? dropTarget : null
  if (drag?.active) justDragged = true
  if (moved && drag) sendCommand({ type: 'move', ids: drag.ids, targetId: moved.id, place: moved.place })
  clearDrop()
  drag = null
}
</logic>

<style>
.heading {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #999;
  margin: 14px 0 4px;
}

.adders button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 6px;
  margin: 0 4px 4px 0;
  cursor: pointer;
}

.adders button:hover {
  background: #333;
}

.hint {
  color: #888;
  font-size: 11px;
  margin: 4px 0;
}

.rows {
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid #333;
  margin-bottom: 6px;
  user-select: none;
}

.row {
  display: flex;
  align-items: center;
  padding: 2px 6px 2px 4px;
  cursor: pointer;
  white-space: nowrap;
  border-top: 1px solid transparent;
  border-bottom: 1px solid transparent;
}

.row:hover {
  background: #1e1e1e;
}

.row.selected {
  background: #2a3650;
}

.row.active {
  box-shadow: inset 2px 0 #6a8fd8;
}

.row.root {
  color: #aaa;
  cursor: default;
}

.indent {
  flex: 0 0 12px;
}

.icon {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  margin-right: 5px;
  color: #8fa3c7;
}

.icon :global(svg) {
  display: block;
  width: 14px;
  height: 14px;
}

.twisty {
  flex: 0 0 14px;
  color: #777;
  font-size: 10px;
  text-align: center;
  transition: transform 0.1s;
}

.twisty.open {
  transform: rotate(90deg);
}

.twisty.hidden {
  visibility: hidden;
}

.name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type {
  flex: 0 0 auto;
  margin-left: 8px;
  color: #666;
  font-size: 10px;
}

.row.drop-before {
  border-top-color: #6a8fd8;
}

.row.drop-after {
  border-bottom-color: #6a8fd8;
}

.row.drop-inside {
  background: rgba(106, 143, 216, 0.35);
}
</style>
