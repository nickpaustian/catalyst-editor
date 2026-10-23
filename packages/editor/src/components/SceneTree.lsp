<view>
<section class="tree">
  <h2 class="heading">Scene</h2>
  <div class="adders">
    <button class="add" @click="openAdd()"><span class="plus">+</span> Add node <kbd>⌘⇧A</kbd></button>
  </div>
  <p class="hint">
    New nodes go under the selected node. Shift-click selects a range, ctrl- or cmd-click adds
    or removes one; in the viewport, shift-drag a rectangle to select what it covers (with cmd
    or ctrl held, to add). Drag a row onto another: its top edge puts it before, its bottom edge
    after, the middle makes it a child. World position is kept.
  </p>
  <div class="rows" @contextmenu="contextEmpty($event)">
    <div
      class="row"
      $for="row in shared['editor:tree']"
      $key="row.id"
      $class="{ selected: row.selected, active: row.active, root: row.isRoot }"
      @pointerdown="press($event, row)"
      @click="select($event, row)"
      @contextmenu="context($event, row)"
    >
      <span class="indent" $for="n in row.depth" $key="n"></span>
      <span class="twisty" $class="{ hidden: !row.hasChildren, open: row.expanded }" @click="toggle($event, row)">▸</span>
      <span class="icon" $html="row.icon"></span>
      <input
        $if="state.renaming === row.id"
        class="rename"
        type="text"
        $value="row.name"
        @keydown="renameKey($event, row)"
        @blur="finishRename($event.target, row)"
        @pointerdown="$event.stopPropagation()"
        @click="$event.stopPropagation()"
      />
      <span $else class="name" @dblclick="startRename($event, row)">{{ row.name }}</span>
      <span class="type">{{ row.type }}</span>
    </div>
  </div>
</section>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { openContextMenu, type MenuItem } from '../contextMenu.ts'

interface Row { id: number; name: string; type: string; icon: string; depth: number; hasChildren: boolean; expanded: boolean; selected: boolean; active: boolean; isRoot: boolean }
type Place = 'before' | 'after' | 'inside'

shared('editor:tree', [])
const addDialog = shared('editor:addDialog', false)
const selection = shared('editor:selection', null)
const state = reactive({ renaming: null as number | null })

// ---- inline rename ----

// Selecting republishes the tree, which rebuilds the rows, so the input is
// shown only once that has settled, and focused once it exists
function startRename(event: Event, row: Row) {
  event.stopPropagation()
  if (row.isRoot) return
  if (!row.selected || !row.active) sendCommand({ type: 'select', id: row.id })
  setTimeout(() => {
    state.renaming = row.id
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('#scene-panel .rename')
      input?.focus()
      input?.select()
    }, 20)
  }, 30)
}

function finishRename(input: HTMLInputElement, row: Row) {
  if (state.renaming !== row.id) return
  state.renaming = null
  const name = input.value.trim()
  if (name && name !== row.name) sendCommand({ type: 'rename', name })
}

function renameKey(event: KeyboardEvent, row: Row) {
  if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
  if (event.key === 'Escape') {
    state.renaming = null
    event.stopPropagation()
  }
}

// ---- context menu ----

function context(event: MouseEvent, row: Row) {
  event.preventDefault()
  event.stopPropagation()
  if (!row.selected) sendCommand({ type: 'select', id: row.id })
  // The selection cell has caught up by the next tick, so the menu reads it
  setTimeout(() => {
    const picked = selection.value as { count: number; prefab: string | null } | null
    const many = (picked?.count ?? 1) > 1
    const items: MenuItem[] = row.isRoot
      ? [{ label: 'Add node…', kbd: '⌘⇧A', run: () => addDialog.set(true) }]
      : [
          { label: 'Add child…', kbd: '⌘⇧A', run: () => addDialog.set(true) },
          { label: 'Rename', disabled: many, run: () => startRename(event, row) },
          { label: 'Duplicate', kbd: '⌘D', run: () => sendCommand({ type: 'duplicate' }) },
          { label: 'Delete', kbd: '⌦', run: () => sendCommand({ type: 'delete' }) },
          { separator: true },
          { label: 'Unparent', disabled: row.depth <= 1, run: () => sendCommand({ type: 'unparent' }) },
          { label: 'Focus', kbd: 'F', run: () => sendCommand({ type: 'focus' }) },
          { separator: true },
          picked?.prefab
            ? { label: 'Unpack prefab', disabled: many, run: () => sendCommand({ type: 'unpackPrefab' }) }
            : { label: 'Make prefab', disabled: many, run: () => sendCommand({ type: 'makePrefab' }) },
        ]
    openContextMenu(event.clientX, event.clientY, items)
  }, 0)
}

function contextEmpty(event: MouseEvent) {
  event.preventDefault()
  openContextMenu(event.clientX, event.clientY, [{ label: 'Add node…', kbd: '⌘⇧A', run: () => addDialog.set(true) }])
}

const DRAG_THRESHOLD = 4
let drag: { ids: number[]; startX: number; startY: number; list: HTMLElement; active: boolean; label: string; ghost: HTMLElement | null } | null = null
const PLACE_WORDS: Record<Place, string> = { before: 'before', after: 'after', inside: 'into' }

// A tag that follows the pointer: what is being dragged, and where it would land
function showGhost(x: number, y: number, target: { name: string; place: Place } | null) {
  if (!drag) return
  if (!drag.ghost) {
    drag.ghost = document.createElement('div')
    drag.ghost.className = 'tree-drag-ghost'
    document.body.appendChild(drag.ghost)
  }
  drag.ghost.textContent = ''
  const what = document.createElement('span')
  what.className = 'what'
  what.textContent = drag.label
  drag.ghost.appendChild(what)
  const where = document.createElement('span')
  where.className = 'where'
  where.textContent = target ? `${PLACE_WORDS[target.place]} ${target.name}` : 'drop on a row'
  drag.ghost.appendChild(where)
  drag.ghost.style.transform = `translate(${x + 14}px, ${y + 12}px)`
}

function hideGhost() {
  drag?.ghost?.remove()
  if (drag) drag.ghost = null
}
let dropTarget: { id: number; place: Place; element: HTMLElement } | null = null
let justDragged = false

function openAdd() {
  addDialog.set(true)
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
  const ids = draggedIds(row)
  drag = { ids, startX: event.clientX, startY: event.clientY, list, active: false, label: ids.length > 1 ? `${ids.length} nodes` : row.name, ghost: null }
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
    showGhost(event.clientX, event.clientY, null)
    return
  }
  const place = placeFor(hit.element, event.clientY)
  showGhost(event.clientX, event.clientY, { name: hit.row.name, place })
  if (dropTarget?.id === hit.row.id && dropTarget.place === place) return
  clearDrop()
  hit.element.classList.add(`drop-${place}`)
  dropTarget = { id: hit.row.id, place, element: hit.element }
}

function release() {
  document.removeEventListener('pointermove', move)
  document.removeEventListener('pointerup', release)
  document.body.classList.remove('tree-dragging')
  hideGhost()
  const moved = drag?.active ? dropTarget : null
  if (drag?.active) justDragged = true
  if (moved && drag) sendCommand({ type: 'move', ids: drag.ids, targetId: moved.id, place: moved.place })
  clearDrop()
  drag = null
}
</logic>

<style>
.heading {
  font-size: var(--cat-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cat-text-secondary);
  margin: var(--cat-space-3) 0 var(--cat-space-1);
}

.adders button {
  display: inline-flex;
  align-items: center;
  gap: var(--cat-space-1);
  font: inherit;
  color: inherit;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-0-5) var(--cat-space-1-5);
  margin: 0 var(--cat-space-1) var(--cat-space-1) 0;
  cursor: pointer;
}

.adders button:hover {
  background: var(--cat-bg-hover);
}

.adders .plus {
  font-weight: 600;
  color: var(--cat-text-secondary);
}

.adders kbd {
  font: var(--cat-text-xs) / 1 var(--cat-font-mono);
  padding: 0 var(--cat-space-1);
  border: 1px solid var(--cat-border);
  border-bottom-width: 2px;
  border-radius: var(--cat-radius-sm);
  background: var(--cat-bg-field);
  color: var(--cat-text-secondary);
  margin-left: var(--cat-space-1);
}

.hint {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
  margin: var(--cat-space-1) 0;
}

.rows {
  overflow-y: auto;
  border: 1px solid var(--cat-border);
  margin-bottom: var(--cat-space-1-5);
  user-select: none;
}

.row {
  display: flex;
  align-items: center;
  padding: var(--cat-space-0-5) var(--cat-space-1-5) var(--cat-space-0-5) var(--cat-space-1);
  cursor: pointer;
  white-space: nowrap;
  border-top: 1px solid transparent;
  border-bottom: 1px solid transparent;
}

.row:hover {
  background: var(--cat-bg-hover);
}

.row.selected {
  background: var(--cat-accent-soft);
}

.row.active {
  box-shadow: inset 2px 0 var(--cat-accent);
}

.row.root {
  color: var(--cat-text-secondary);
  cursor: default;
}

.indent {
  flex: 0 0 12px;
}

.icon {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  margin-right: var(--cat-space-1);
  color: var(--cat-text-secondary);
}

.icon :global(svg) {
  display: block;
  width: 14px;
  height: 14px;
}

.twisty {
  flex: 0 0 14px;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
  text-align: center;
  transition: transform 0.1s;
}

.twisty.open {
  transform: rotate(90deg);
}

.twisty.hidden {
  visibility: hidden;
}

.rename {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  color: var(--cat-text-primary);
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-accent);
  border-radius: var(--cat-radius-xs);
  padding: 0 var(--cat-space-1);
}

.name {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type {
  flex: 0 0 auto;
  margin-left: var(--cat-space-2);
  color: var(--cat-text-tertiary);
  font: var(--cat-text-xs) / var(--cat-leading-tight) var(--cat-font-mono);
}

.row.drop-before {
  border-top-color: var(--cat-accent);
}

.row.drop-after {
  border-bottom-color: var(--cat-accent);
}

.row.drop-inside {
  background: var(--cat-accent-soft);
  box-shadow: inset 0 0 0 1px var(--cat-accent);
}

:global(.tree-drag-ghost) {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  padding: var(--cat-space-1) var(--cat-space-2);
  background: var(--cat-bg-raised);
  border: 1px solid var(--cat-accent);
  border-radius: var(--cat-radius-sm);
  box-shadow: var(--cat-shadow-e1);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / var(--cat-leading-tight) var(--cat-font-ui);
  pointer-events: none;
  white-space: nowrap;
}

:global(.tree-drag-ghost .what) {
  font-weight: 600;
}

:global(.tree-drag-ghost .where) {
  color: var(--cat-text-secondary);
  font-size: var(--cat-text-xs);
}

:global(body.tree-dragging) {
  cursor: grabbing;
}
</style>
