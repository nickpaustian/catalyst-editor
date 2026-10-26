<view>
<aside class="panel" $class="{ dropping: state.dropTarget === '' }" @dragover="dragOver($event, null)" @dragleave="dragLeave($event)" @drop="drop($event, null)">
  <div class="toolbar" $if="shared['editor:project'].open">
    <label class="well filter">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 4 4"/></svg>
      <input type="search" placeholder="Filter" aria-label="Filter files" $model="state.filter" @input="refresh()" />
    </label>
  </div>
  <div class="rows" role="tree" aria-label="Project files" tabindex="0" $ref="list" $if="state.count || state.creating" @contextmenu="contextEmpty($event)" @keydown="keyDown($event)" @scroll="slide()">
    <div class="window" $style="'height: ' + state.height + 'px; padding-top: ' + state.before + 'px'">
    <div
      class="row"
      role="treeitem"
      $for="row in state.shown"
      $key="row.path"
      $class="{ selected: row.path === state.selected, dir: row.kind === 'directory', creating: row.kind === 'creating', drop: row.kind === 'directory' && row.path === state.dropTarget }"
      $style="'--depth: ' + row.depth"
      $aria-expanded="row.kind === 'directory' ? row.expanded : null"
      $draggable="row.kind === 'creating' || state.renaming === row.path ? 'false' : 'true'"
      @click="pick(row)"
      @contextmenu="context($event, row)"
      @dragstart="dragStart($event, row)"
      @dragend="dragEnd()"
      @dragover="dragOver($event, row)"
      @drop="drop($event, row)"
    >
      <span class="twisty" $class="{ hidden: row.kind !== 'directory', open: row.expanded }" @click="toggle($event, row)">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>
      </span>
      <span class="icon" $html="row.icon"></span>
      <input
        $if="row.kind === 'creating'"
        class="rename"
        type="text"
        aria-label="Name"
        spellcheck="false"
        $placeholder="row.type"
        @keydown="createKey($event)"
        @blur="cancelCreate()"
        @click="$event.stopPropagation()"
      />
      <input
        $else-if="state.renaming === row.path"
        class="rename"
        type="text"
        aria-label="Name"
        spellcheck="false"
        $value="row.name"
        @keydown="renameKey($event, row)"
        @blur="finishRename($event.target, row)"
        @click="$event.stopPropagation()"
      />
      <span $else class="name">{{ row.name }}</span>
      <span class="type" $if="row.kind !== 'creating'">{{ row.type }}</span>
    </div>
    </div>
    <p class="no-match" $if="state.filter && !state.count">Nothing matches “{{ state.filter }}”.</p>
  </div>
  <div class="empty-state" $else-if="shared['editor:project'].open">
    <span class="what">No files yet</span>
    <span class="how">Save the scene, or import a file with the + above or by dropping it here.</span>
  </div>
  <div class="empty-state" $else>
    <span class="what">No project open</span>
    <span class="how">The project's files are listed here.</span>
  </div>
  <div class="details" $if="shared['editor:fileInfo']">
    <img class="preview" $if="shared['editor:fileInfo'].preview" $src="shared['editor:fileInfo'].preview" alt="" />
    <div class="facts">
      <span class="path mono">{{ shared['editor:fileInfo'].path }}</span>
      <span class="dim">{{ shared['editor:fileInfo'].facts }}</span>
    </div>
  </div>
</aside>
</view>

<logic lang="ts">
import { reactive, shared, defineRefs, onUnmounted } from '@lightspeed-js/core'
import { DRAGGING_FILE_CELL } from '../fileField.ts'
import { sendCommand } from '../commands.ts'
import { openContextMenu, type MenuItem } from '../contextMenu.ts'
import { PREVIEW_DEFAULT, PROJECT_DEFAULT, STREAMABLE_DEFAULT } from '../cells.ts'
import { RowWindow } from '../rowWindow.ts'

interface Entry { path: string; name: string; kind: 'file' | 'directory'; children?: Entry[] }
interface Row { path: string; name: string; kind: 'file' | 'directory' | 'creating'; depth: number; expanded: boolean; icon: string; type: string }
interface Creating { dir: string; kind: 'folder' | 'script' }

const files = shared('editor:files', [])
shared('editor:project', PROJECT_DEFAULT)
shared('editor:fileInfo', null)
const streamable = shared('editor:streamable', STREAMABLE_DEFAULT)
const preview = shared('editor:preview', PREVIEW_DEFAULT)
const revealer = shared('editor:reveal', null)
const state = reactive({ shown: [] as Row[], count: 0, before: 0, height: 0, selected: null as string | null, filter: '', renaming: null as string | null, creating: null as Creating | null, dropTarget: null as string | null })
// Folders closed by hand; every folder starts open
const collapsed = new Set<string>()
// Packages shown as folders by hand; every package starts as one asset
const opened = new Set<string>()
let tree: Entry[] = []
// Every row, open folders flattened; only the rows in view (state.shown) are rendered
let rows: Row[] = []
const refs = defineRefs<{ list: HTMLElement }>()

const svg = (paths: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const icons = {
  folder: svg('<path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13z"/>'),
  script: svg('<path d="M5.5 5 2.5 8l3 3M10.5 5l3 3-3 3M9 3.5l-2 9"/>'),
  model: svg('<path d="M2 11.5 8 14.5l6-3V5L8 2 2 5z"/><path d="M2 5l6 3 6-3M8 8v6.5"/>'),
  image: svg('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="m2.5 11 3.5-3.5 2.5 2.5 2-2 3 3"/><circle cx="10.5" cy="6" r="1"/>'),
  light: svg('<circle cx="8" cy="8" r="3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>'),
  scene: svg('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>'),
  file: svg('<path d="M4 1.5h5.5l3 3v10h-8.5z"/><path d="M9.5 1.5v3h3"/>'),
  theca: svg('<path d="M2 11.5 8 14.5l6-3V5L8 2 2 5z"/><path d="M2 5l6 3 6-3M8 8v6.5"/><path d="M4.5 9.5h7M4.5 11.5h7" stroke-dasharray="1 1"/>'),
}

const MODEL = /\.(glb|gltf)$/i
const GLB = /\.glb$/i
const THECA = /\.theca$/i
const CODE = /\.(ts|js|lsp|css)$/i
const PREVIEWABLE = /\.(png|jpe?g|webp|gif|avif|svg|glb|gltf)$/i
const IMAGE = /\.(png|jpe?g|webp|gif|avif|svg)$/i
const SCRIPT = /\.(ts|js)$/i
const HDR = /\.hdr$/i
const SCRIPTS_DIR = 'scripts'
const PREFAB = /^prefabs\/.+\.json$/i

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function iconFor(entry: Entry): string {
  if (entry.kind === 'directory') return icons.folder
  if (SCRIPT.test(entry.name)) return icons.script
  if (MODEL.test(entry.name)) return icons.model
  if (IMAGE.test(entry.name)) return icons.image
  if (HDR.test(entry.name)) return icons.light
  if (/\.(json|catalyst)$/i.test(entry.name)) return icons.scene
  return icons.file
}

function parentOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

// With a filter every folder is open and only matching files and their folders are listed
function flatten(entries: Entry[], depth: number, out: Row[], needle: string) {
  for (const entry of entries) {
    // A package is one asset, listed as a file, until it is opened to show what is inside
    if (entry.kind === 'directory' && THECA.test(entry.name) && !opened.has(entry.path)) {
      if (needle === '' || entry.name.toLowerCase().includes(needle)) out.push({ path: entry.path, name: entry.name, kind: 'file', depth, expanded: false, icon: icons.theca, type: 'theca' })
      continue
    }
    const expanded = entry.kind === 'directory' && (needle !== '' || !collapsed.has(entry.path))
    const children: Row[] = []
    if (entry.kind === 'directory' && entry.children) flatten(entry.children, depth + 1, children, needle)
    const matches = needle === '' || entry.name.toLowerCase().includes(needle)
    if (entry.kind === 'directory' && needle !== '' && !matches && children.length === 0) continue
    if (entry.kind === 'file' && !matches) continue
    out.push({ path: entry.path, name: entry.name, kind: entry.kind, depth, expanded, icon: iconFor(entry), type: entry.kind === 'directory' ? '' : extension(entry.name) })
    if (expanded) {
      if (state.creating && state.creating.dir === entry.path) out.push(creatingRow(state.creating, depth + 1))
      out.push(...children)
    }
  }
}

// The row with the input for a new folder or script, under its folder, or at the root
function creatingRow(creating: Creating, depth: number): Row {
  return { path: '\0creating', name: '', kind: 'creating', depth, expanded: false, icon: creating.kind === 'folder' ? icons.folder : icons.script, type: creating.kind === 'folder' ? 'folder name' : 'ScriptName' }
}

function refresh() {
  const next: Row[] = []
  if (state.creating && state.creating.dir === '') next.push(creatingRow(state.creating, 0))
  flatten(tree, 0, next, state.filter.trim().toLowerCase())
  rows = next
  state.count = rows.length
  rowWindow.set(rows)
  if (state.selected && !rows.some((r) => r.path === state.selected)) {
    state.selected = null
    sendCommand({ type: 'fileInfo', path: null })
  }
}

// ---- the rows in view ----

const rowWindow = new RowWindow<Row>({
  list: () => refs.list,
  show: (shown, before, height) => Object.assign(state, { shown, before, height }),
  chosen: () => rows.findIndex((r) => r.path === state.selected),
})
onUnmounted(() => rowWindow.destroy())

function slide() {
  rowWindow.slide()
}

function reveal(path: string) {
  rowWindow.reveal(rows.findIndex((r) => r.path === path))
}

files.subscribe((next: Entry[] | undefined) => {
  tree = next ?? []
  refresh()
})

// Selecting re-renders the rows, which loses a double-click, so two quick clicks on one row are read here
const DOUBLE_CLICK_MS = 400
let lastClick = { path: '', at: 0 }

function pick(row: Row) {
  if (state.renaming === row.path || row.kind === 'creating') return
  state.selected = row.path
  sendCommand({ type: 'fileInfo', path: row.kind === 'file' ? row.path : null })
  const now = performance.now()
  const again = lastClick.path === row.path && now - lastClick.at < DOUBLE_CLICK_MS
  lastClick = { path: row.path, at: again ? 0 : now }
  if (again) activate(row)
}

function toggle(event: Event, row: Row) {
  event.stopPropagation()
  if (row.kind !== 'directory') return
  if (collapsed.has(row.path)) collapsed.delete(row.path)
  else collapsed.add(row.path)
  refresh()
}

// Two clicks open what can be opened: a script in the code pane, a folder's rows
function activate(row: Row) {
  if (row.kind === 'directory') return toggle(new Event('click'), row)
  if (CODE.test(row.name)) sendCommand({ type: 'openFile', path: row.path })
}

// ---- rename ----

function startRename(row: Row) {
  state.renaming = row.path
  reveal(row.path)
  setTimeout(() => {
    const input = document.querySelector<HTMLInputElement>('#files-panel .rename')
    if (!input) return
    input.focus()
    const dot = row.kind === 'file' ? row.name.lastIndexOf('.') : -1
    input.setSelectionRange(0, dot > 0 ? dot : row.name.length)
  }, 0)
}

function renameKey(event: KeyboardEvent, row: Row) {
  if (event.key === 'Enter') {
    event.preventDefault()
    finishRename(event.target as HTMLInputElement, row)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    state.renaming = null
  }
}

function finishRename(target: EventTarget | null, row: Row) {
  if (state.renaming !== row.path) return
  state.renaming = null
  const name = (target as HTMLInputElement | null)?.value.trim() ?? ''
  if (!name || name === row.name) return
  const parent = parentOf(row.path)
  const to = parent ? `${parent}/${name}` : name
  sendCommand({ type: 'renameFile', from: row.path, to })
  state.selected = to
}

// ---- new folder, new script ----

function startCreate(dir: string, kind: Creating['kind']) {
  if (dir && collapsed.has(dir)) collapsed.delete(dir)
  state.creating = { dir, kind }
  refresh()
  reveal('\0creating')
  focusWhenRendered('#files-panel .creating .rename')
}

// The input appears with the render, a frame or two after the state changes
function focusWhenRendered(selector: string, tries = 0) {
  const input = document.querySelector<HTMLInputElement>(selector)
  if (input) return input.focus()
  if (tries < 30) requestAnimationFrame(() => focusWhenRendered(selector, tries + 1))
}

function createKey(event: KeyboardEvent) {
  const creating = state.creating
  if (!creating) return
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelCreate()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const name = (event.target as HTMLInputElement).value.trim()
    state.creating = null
    refresh()
    if (!name) return
    if (creating.kind === 'folder') sendCommand({ type: 'newFolder', path: creating.dir ? `${creating.dir}/${name}` : name })
    else sendCommand({ type: 'newScript', name, attach: false })
  }
}

function cancelCreate() {
  if (!state.creating) return
  state.creating = null
  refresh()
}

// ---- delete ----

function remove(row: Row) {
  sendCommand({ type: 'deleteFile', path: row.path })
}

// The list's own keys: Enter renames, Backspace deletes; keys typed into a rename or create input are the input's
function keyDown(event: KeyboardEvent) {
  if ((event.target as HTMLElement).tagName === 'INPUT' || state.renaming || state.creating) return
  const row = rows.find((r) => r.path === state.selected)
  if (!row) return
  if (event.key === ' ') {
    // Space shows the chosen file in the preview window, or puts it away, as Quick Look does.
    event.preventDefault()
    if (preview.value?.open) sendCommand({ type: 'closePreview' })
    else if (row.kind === 'file' && PREVIEWABLE.test(row.name)) sendCommand({ type: 'preview', path: row.path })
  } else if (event.key === 'Enter' || event.key === 'F2') {
    event.preventDefault()
    startRename(row)
  } else if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault()
    remove(row)
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    step(row, event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    if (row.kind === 'directory' && !row.expanded) toggle(event, row)
    else step(row, 1)
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault()
    if (row.kind === 'directory' && row.expanded) toggle(event, row)
    else {
      const parent = rows.find((r) => r.path === parentOf(row.path))
      if (parent) choose(parent)
    }
  }
}

function step(from: Row, by: number) {
  const steps = rows.filter((r) => r.kind !== 'creating')
  const next = steps[steps.indexOf(from) + by]
  if (next) choose(next)
  // An open preview follows the chosen file while it is one the window can show.
  if (next && preview.value?.open && next.kind === 'file' && PREVIEWABLE.test(next.name)) sendCommand({ type: 'preview', path: next.path })
}

function choose(row: Row) {
  state.selected = row.path
  reveal(row.path)
  sendCommand({ type: 'fileInfo', path: row.kind === 'file' ? row.path : null })
}

// ---- drag out, drop in ----

// A row dragged onto a folder here moves into it; onto the viewport it is placed (a model) or applied (an hdr); onto a scene node a script attaches
function dragStart(event: DragEvent, row: Row) {
  if (row.kind === 'creating' || !event.dataTransfer) return
  event.dataTransfer.setData('text/catalyst-file', row.path)
  event.dataTransfer.setData('text/plain', row.path)
  event.dataTransfer.effectAllowed = 'all'
  if (row.kind === 'file') shared(DRAGGING_FILE_CELL).set(row.path)
}

function dragEnd() {
  shared(DRAGGING_FILE_CELL).set(null)
}

// Where a drop on this row would land: the folder itself, or a file's folder
function targetDir(row: Row | null): string {
  return row ? (row.kind === 'directory' ? row.path : parentOf(row.path)) : ''
}

// Files from outside the page, and rows from this pane, land in the folder they are dropped on (or in assets, or the root for a row)
function dragOver(event: DragEvent, row: Row | null) {
  const types = event.dataTransfer?.types
  if (!event.dataTransfer || !types || !(types.includes('Files') || types.includes('text/catalyst-file'))) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = types.includes('Files') ? 'copy' : 'move'
  state.dropTarget = targetDir(row)
}

function dragLeave(event: DragEvent) {
  if (event.currentTarget === event.target || !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) state.dropTarget = null
}

function drop(event: DragEvent, row: Row | null) {
  const transfer = event.dataTransfer
  state.dropTarget = null
  if (!transfer) return
  const moved = transfer.getData('text/catalyst-file')
  if (moved) {
    event.preventDefault()
    event.stopPropagation()
    const dir = targetDir(row)
    const name = moved.split('/').pop() ?? moved
    // Not onto itself, its own folder, or inside itself
    if (dir === parentOf(moved) || dir === moved || dir.startsWith(`${moved}/`)) return
    sendCommand({ type: 'renameFile', from: moved, to: dir ? `${dir}/${name}` : name })
    return
  }
  if (transfer.files.length === 0) return
  event.preventDefault()
  event.stopPropagation()
  const dir = row ? targetDir(row) : 'assets'
  sendCommand({ type: 'importDropped', dir: dir || 'assets', files: [...transfer.files] })
}

// ---- menus ----

function itemsFor(row: Row): MenuItem[] {
  const items: MenuItem[] = []
  if (row.kind === 'creating') return []
  if (row.kind === 'directory') {
    items.push({ label: 'Import file here…', run: () => sendCommand({ type: 'importAsset', dir: row.path }) })
    items.push({ label: 'New folder…', run: () => startCreate(row.path, 'folder') })
    if (row.path === SCRIPTS_DIR) items.push({ label: 'New script…', run: () => startCreate(row.path, 'script') })
    if (THECA.test(row.name)) items.push({ label: 'Hide contents', run: () => showContents(row.path, false) })
  } else if (THECA.test(row.name)) {
    items.push({ label: 'Add to scene', run: () => sendCommand({ type: 'addTheca', path: row.path }) })
    if (streamable.value?.available) items.push({ label: 'Rebuild…', run: () => sendCommand({ type: 'rebuildTheca', path: row.path }) })
    items.push({ label: 'Show contents', run: () => showContents(row.path, true) })
  } else {
    if (CODE.test(row.name)) items.push({ label: 'Open in code pane', run: () => sendCommand({ type: 'openFile', path: row.path }) })
    if (PREVIEWABLE.test(row.name)) items.push({ label: 'Preview', kbd: 'Space', run: () => sendCommand({ type: 'preview', path: row.path }) })
    if (MODEL.test(row.name)) items.push({ label: 'Add to scene', run: () => sendCommand({ type: 'addModel', path: row.path }) })
    if (GLB.test(row.name) && streamable.value?.available) items.push({ label: 'Make streamable…', run: () => sendCommand({ type: 'streamable', path: row.path }) })
    if (HDR.test(row.name)) items.push({ label: 'Use as environment', run: () => sendCommand({ type: 'useEnvironment', path: row.path }) })
    if (PREFAB.test(row.path)) items.push({ label: 'Add to scene', run: () => sendCommand({ type: 'add', kind: `prefab:${row.path}` }) })
  }
  items.push({ separator: true })
  items.push({ label: 'Rename', kbd: '↵', run: () => startRename(row) })
  items.push({ label: 'Copy path', run: () => void navigator.clipboard?.writeText(row.path) })
  if (revealer.value) items.push({ label: revealer.value, run: () => sendCommand({ type: 'revealFile', path: row.path }) })
  items.push({ label: 'Delete', kbd: '⌫', danger: true, run: () => remove(row) })
  items.push({ separator: true })
  items.push({ label: 'Refresh', run: () => sendCommand({ type: 'refreshFiles' }) })
  return items
}

function showContents(path: string, show: boolean) {
  if (show) opened.add(path)
  else opened.delete(path)
  refresh()
}

function context(event: MouseEvent, row: Row) {
  event.preventDefault()
  event.stopPropagation()
  if (row.kind === 'creating') return
  state.selected = row.path
  sendCommand({ type: 'fileInfo', path: row.kind === 'file' ? row.path : null })
  openContextMenu(event.clientX, event.clientY, itemsFor(row))
}

function contextEmpty(event: MouseEvent) {
  event.preventDefault()
  const items: MenuItem[] = [
    { label: 'Import file…', run: () => sendCommand({ type: 'importAsset' }) },
    { label: 'New folder…', run: () => startCreate('', 'folder') },
    { label: 'New script…', run: () => startCreate(SCRIPTS_DIR, 'script') },
    { separator: true },
  ]
  if (revealer.value) items.push({ label: revealer.value, run: () => sendCommand({ type: 'revealFile', path: '' }) })
  items.push({ label: 'Refresh', run: () => sendCommand({ type: 'refreshFiles' }) })
  openContextMenu(event.clientX, event.clientY, items)
}
</logic>

<style>
.panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--cat-bg-panel);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / var(--cat-leading-body) var(--cat-font-ui);
}

.panel.dropping {
  box-shadow: inset 0 0 0 2px var(--cat-accent);
}

.toolbar {
  flex: 0 0 auto;
  padding: var(--cat-space-1) var(--cat-space-1) 0;
}

.filter {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1-5);
  width: 100%;
  box-sizing: border-box;
  color: var(--cat-text-tertiary);
}

.filter svg {
  flex: 0 0 auto;
  width: var(--cat-icon-xs);
  height: var(--cat-icon-xs);
}

.filter input {
  flex: 1 1 auto;
  min-width: 0;
  background: none;
  border: 0;
  color: var(--cat-text-primary);
  font: inherit;
  outline: none;
}

.rows {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: var(--cat-space-1);
  box-sizing: border-box;
  outline: none;
  overflow-anchor: none;
}

.window {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.empty-state {
  flex: 1 1 auto;
}

.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--cat-space-1-5);
  flex: 0 0 var(--cat-row);
  height: var(--cat-row);
  padding: 0 var(--cat-space-2) 0 calc(var(--cat-space-1) + var(--depth, 0) * var(--cat-tree-indent));
  border-radius: var(--cat-radius-sm);
  cursor: default;
  user-select: none;
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

.row.drop {
  box-shadow: inset 0 0 0 1px var(--cat-accent);
}

.twisty {
  display: flex;
  flex: 0 0 var(--cat-icon-xs);
  width: var(--cat-icon-xs);
  height: var(--cat-icon-xs);
  color: var(--cat-text-tertiary);
  transition: transform 120ms ease;
}

.twisty.open {
  transform: rotate(90deg);
}

.twisty.hidden {
  visibility: hidden;
}

.twisty svg {
  width: 100%;
  height: 100%;
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

.row.dir .icon {
  color: var(--cat-text-tertiary);
}

.name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rename {
  flex: 1 1 auto;
  min-width: 0;
  height: calc(var(--cat-row) - 6px);
  padding: 0 var(--cat-space-1);
  box-sizing: border-box;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-accent);
  border-radius: var(--cat-radius-sm);
  color: var(--cat-text-primary);
  font: inherit;
  outline: none;
}

.type {
  flex: 0 0 auto;
  color: var(--cat-text-tertiary);
  font: var(--cat-text-xs) / var(--cat-leading-tight) var(--cat-font-mono);
}

.no-match {
  margin: var(--cat-space-2);
  color: var(--cat-text-tertiary);
}

.details {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--cat-space-2);
  padding: var(--cat-space-1-5) var(--cat-space-2);
  border-top: 1px solid var(--cat-border);
  min-width: 0;
}

.preview {
  flex: 0 0 auto;
  width: 56px;
  height: 40px;
  object-fit: cover;
  border-radius: var(--cat-radius-sm);
  border: 1px solid var(--cat-border);
  background: var(--cat-bg-field);
}

.facts {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.facts .path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.facts .dim {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}
</style>
