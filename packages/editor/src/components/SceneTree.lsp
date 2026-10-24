<view>
<div class="rows" role="tree" aria-label="Scene nodes" aria-multiselectable="true" tabindex="0" @contextmenu="contextEmpty($event)">
  <div
    class="row"
    role="treeitem"
    $for="row in shared['editor:tree']"
    $key="row.id"
    $class="{ selected: row.selected, active: row.active, root: row.isRoot }"
    $style="'--depth: ' + row.depth"
    $aria-selected="row.selected"
    $aria-expanded="row.hasChildren ? row.expanded : null"
    @pointerdown="press($event, row)"
    @click="select($event, row)"
    @contextmenu="context($event, row)"
    @dragover="fileOver($event, row)"
    @drop="fileDrop($event, row)"
  >
    <span class="twisty" $class="{ hidden: !row.hasChildren, open: row.expanded }" @click="toggle($event, row)">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>
    </span>
    <span class="icon" $html="row.icon"></span>
    <input
      $if="state.renaming === row.id"
      class="rename"
      type="text"
      aria-label="Name"
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

// ---- files dragged from the files pane ----

const SCRIPT_FILE = /\.(ts|js)$/i

// A script dropped on a node attaches to it
function fileOver(event: DragEvent, row: Row) {
  if (row.isRoot || !event.dataTransfer?.types.includes('text/catalyst-file')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'link'
}

function fileDrop(event: DragEvent, row: Row) {
  const path = event.dataTransfer?.getData('text/catalyst-file')
  if (!path || row.isRoot) return
  event.preventDefault()
  event.stopPropagation()
  if (SCRIPT_FILE.test(path)) sendCommand({ type: 'attachScriptTo', id: row.id, url: path })
}

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

const PRIMITIVES = new Set(['Box', 'Sphere', 'Capsule', 'Cylinder', 'Wedge'])

function context(event: MouseEvent, row: Row) {
  event.preventDefault()
  event.stopPropagation()
  if (!row.selected) sendCommand({ type: 'select', id: row.id })
  // The selection cell has caught up by the next tick, so the menu reads it
  setTimeout(() => {
    const picked = selection.value as { count: number; prefab: string | null; type: string } | null
    const many = (picked?.count ?? 1) > 1
    const items: MenuItem[] = row.isRoot
      ? [{ label: 'Add node…', kbd: '⌘⇧A', run: () => addDialog.set(true) }]
      : [
          { label: 'Add child…', kbd: '⌘⇧A', run: () => addDialog.set(true) },
          ...(picked?.type === 'Model' && !many ? [{ label: 'Add collider from bounds', run: () => sendCommand({ type: 'addBoundsCollider' }) }, { label: 'Add mesh collider', run: () => sendCommand({ type: 'addMeshCollider' }) }] : []),
          ...(PRIMITIVES.has(picked?.type ?? '') && !many ? [{ label: 'Convert to editable mesh', run: () => sendCommand({ type: 'convertToMesh' }) }] : []),
          { label: 'Rename', disabled: many, run: () => startRename(event, row) },
          { label: 'Duplicate', kbd: '⌘D', run: () => sendCommand({ type: 'duplicate' }) },
          { label: 'Delete', kbd: '⌦', danger: true, run: () => sendCommand({ type: 'delete' }) },
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
  if (fraction < 1 / 3) return 'before'
  if (fraction > 2 / 3) return 'after'
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
.rows {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: var(--cat-space-1);
  box-sizing: border-box;
  outline: none;
  user-select: none;
}

.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--cat-space-1-5);
  flex: 0 0 var(--cat-row);
  padding: 0 var(--cat-space-2) 0 calc(var(--cat-space-1) + var(--depth, 0) * var(--cat-tree-indent));
  border-radius: var(--cat-radius-sm);
  white-space: nowrap;
  cursor: pointer;
}

.row:hover {
  background: var(--cat-bg-hover);
}

.row.selected {
  background: var(--cat-bg-active);
}

.rows:focus-within .row.selected {
  background: var(--cat-accent-soft);
}

.row.selected .type {
  color: var(--cat-text-secondary);
}

.row.active .name {
  font-weight: 500;
}

.rows:focus-within .row.active .icon {
  color: var(--cat-accent);
}

.row.root {
  cursor: default;
}

.twisty {
  display: flex;
  flex: 0 0 var(--cat-icon-xs);
  color: var(--cat-text-tertiary);
  transition: transform var(--cat-dur-fast) var(--cat-ease);
}

.twisty svg {
  width: var(--cat-icon-xs);
  height: var(--cat-icon-xs);
}

.twisty.open {
  transform: rotate(90deg);
}

.twisty.hidden {
  visibility: hidden;
}

.icon {
  flex: 0 0 var(--cat-icon-sm);
  width: var(--cat-icon-sm);
  height: var(--cat-icon-sm);
  color: var(--cat-text-secondary);
}

.icon :global(svg) {
  display: block;
  width: var(--cat-icon-sm);
  height: var(--cat-icon-sm);
}

.rename {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--cat-h-xs);
  padding: 0 var(--cat-space-1);
  box-sizing: border-box;
  background: var(--cat-bg-app);
  border: 1px solid var(--cat-accent);
  border-radius: var(--cat-radius-xs);
  color: var(--cat-text-primary);
  outline: none;
}

.name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type {
  flex: 0 0 auto;
  color: var(--cat-text-tertiary);
  font: var(--cat-text-xs) / var(--cat-leading-tight) var(--cat-font-mono);
}

.row.drop-before::after,
.row.drop-after::after {
  content: "";
  position: absolute;
  left: calc(var(--cat-space-1) + var(--depth, 0) * var(--cat-tree-indent));
  right: 0;
  height: 2px;
  background: var(--cat-accent);
  pointer-events: none;
}

.row.drop-before::after {
  top: -1px;
}

.row.drop-after::after {
  bottom: -1px;
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
