<view>
<aside class="panel">
  <div class="rows" role="tree" aria-label="Project files" tabindex="0" $if="state.rows.length" @contextmenu="contextEmpty($event)">
    <div
      class="row"
      role="treeitem"
      $for="row in state.rows"
      $key="row.path"
      $class="{ selected: row.path === state.selected, dir: row.kind === 'directory' }"
      $style="'--depth: ' + row.depth"
      $aria-expanded="row.kind === 'directory' ? row.expanded : null"
      @click="pick(row)"
      @contextmenu="context($event, row)"
    >
      <span class="twisty" $class="{ hidden: row.kind !== 'directory', open: row.expanded }" @click="toggle($event, row)">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>
      </span>
      <span class="icon" $html="row.icon"></span>
      <span class="name">{{ row.name }}</span>
      <span class="type">{{ row.type }}</span>
    </div>
  </div>
  <div class="empty-state" $else-if="shared['editor:project'].open">
    <span class="what">No files yet</span>
    <span class="how">Save the scene, or import a file with the + above.</span>
  </div>
  <div class="empty-state" $else>
    <span class="what">No project open</span>
    <span class="how">The project's files are listed here.</span>
  </div>
</aside>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { openContextMenu, type MenuItem } from '../contextMenu.ts'
import { PROJECT_DEFAULT } from '../cells.ts'

interface Entry { path: string; name: string; kind: 'file' | 'directory'; children?: Entry[] }
interface Row { path: string; name: string; kind: 'file' | 'directory'; depth: number; expanded: boolean; icon: string; type: string }

const files = shared('editor:files', [])
shared('editor:project', PROJECT_DEFAULT)
const state = reactive({ rows: [] as Row[], selected: null as string | null })
// Folders closed by hand; every folder starts open
const collapsed = new Set<string>()
let tree: Entry[] = []

const svg = (paths: string) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const ICONS = {
  folder: svg('<path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13z"/>'),
  script: svg('<path d="M5.5 5 2.5 8l3 3M10.5 5l3 3-3 3M9 3.5l-2 9"/>'),
  model: svg('<path d="M2 11.5 8 14.5l6-3V5L8 2 2 5z"/><path d="M2 5l6 3 6-3M8 8v6.5"/>'),
  image: svg('<rect x="2" y="3" width="12" height="10" rx="1"/><path d="m2.5 11 3.5-3.5 2.5 2.5 2-2 3 3"/><circle cx="10.5" cy="6" r="1"/>'),
  light: svg('<circle cx="8" cy="8" r="3"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>'),
  scene: svg('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>'),
  file: svg('<path d="M4 1.5h5.5l3 3v10h-8.5z"/><path d="M9.5 1.5v3h3"/>'),
}

const MODEL = /\.(glb|gltf)$/i
const IMAGE = /\.(png|jpe?g|webp|gif|avif|svg)$/i
const SCRIPT = /\.(ts|js)$/i
const HDR = /\.hdr$/i

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function iconFor(entry: Entry): string {
  if (entry.kind === 'directory') return ICONS.folder
  if (SCRIPT.test(entry.name)) return ICONS.script
  if (MODEL.test(entry.name)) return ICONS.model
  if (IMAGE.test(entry.name)) return ICONS.image
  if (HDR.test(entry.name)) return ICONS.light
  if (/\.(json|catalyst)$/i.test(entry.name)) return ICONS.scene
  return ICONS.file
}

function flatten(entries: Entry[], depth: number, out: Row[]) {
  for (const entry of entries) {
    const expanded = entry.kind === 'directory' && !collapsed.has(entry.path)
    out.push({ path: entry.path, name: entry.name, kind: entry.kind, depth, expanded, icon: iconFor(entry), type: entry.kind === 'directory' ? '' : extension(entry.name) })
    if (expanded && entry.children) flatten(entry.children, depth + 1, out)
  }
}

function refresh() {
  const rows: Row[] = []
  flatten(tree, 0, rows)
  state.rows = rows
  if (state.selected && !rows.some((r) => r.path === state.selected)) state.selected = null
}

files.subscribe((next: Entry[] | undefined) => {
  tree = next ?? []
  refresh()
})

// Selecting re-renders the rows, which loses a double-click, so two quick clicks on one row are read here
const DOUBLE_CLICK_MS = 400
let lastClick = { path: '', at: 0 }

function pick(row: Row) {
  state.selected = row.path
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
  if (SCRIPT.test(row.name)) sendCommand({ type: 'openFile', path: row.path })
}

function itemsFor(row: Row): MenuItem[] {
  const items: MenuItem[] = []
  if (row.kind === 'directory') {
    items.push({ label: 'Import file here…', run: () => sendCommand({ type: 'importAsset', dir: row.path }) })
  } else {
    if (SCRIPT.test(row.name)) items.push({ label: 'Open in code pane', run: () => sendCommand({ type: 'openFile', path: row.path }) })
    if (MODEL.test(row.name)) items.push({ label: 'Add to scene', run: () => sendCommand({ type: 'addModel', path: row.path }) })
    if (HDR.test(row.name)) items.push({ label: 'Use as environment', run: () => sendCommand({ type: 'useEnvironment', path: row.path }) })
  }
  if (items.length) items.push({ separator: true })
  items.push({ label: 'Copy path', run: () => void navigator.clipboard?.writeText(row.path) })
  items.push({ label: 'Refresh', run: () => sendCommand({ type: 'refreshFiles' }) })
  return items
}

function context(event: MouseEvent, row: Row) {
  event.preventDefault()
  event.stopPropagation()
  state.selected = row.path
  openContextMenu(event.clientX, event.clientY, itemsFor(row))
}

function contextEmpty(event: MouseEvent) {
  event.preventDefault()
  openContextMenu(event.clientX, event.clientY, [
    { label: 'Import file…', run: () => sendCommand({ type: 'importAsset' }) },
    { label: 'Refresh', run: () => sendCommand({ type: 'refreshFiles' }) },
  ])
}
</logic>

<style>
.panel {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  background: var(--cat-bg-panel);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / var(--cat-leading-body) var(--cat-font-ui);
}

.rows {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: var(--cat-space-1);
  box-sizing: border-box;
  outline: none;
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

.type {
  flex: 0 0 auto;
  color: var(--cat-text-tertiary);
  font: var(--cat-text-xs) / var(--cat-leading-tight) var(--cat-font-mono);
}
</style>
