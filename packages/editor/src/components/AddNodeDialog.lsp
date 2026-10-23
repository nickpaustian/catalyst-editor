<view>
<div class="scrim" $if="shared['editor:addDialog']" @pointerdown="close()">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="add-node-title" @pointerdown="$event.stopPropagation()">
    <h2 class="dialog-title" id="add-node-title">Add node</h2>
    <div class="body">
      <aside class="recent">
        <h3 class="section-label">Recent</h3>
        <button class="row flat" $for="item in state.recent" $key="item.id" $class="{ picked: item.id === state.picked }" @click="pick(item.id)" @dblclick="create()">
          <span class="icon" $html="item.icon"></span><span class="label">{{ item.label }}</span>
        </button>
        <p class="hint" $if="state.recent.length === 0">Nothing yet.</p>
      </aside>
      <section class="matches">
        <input class="well large search" type="search" placeholder="Search" aria-label="Search node kinds" $model="state.search" @input="refresh()" @keydown="key($event)" />
        <div class="rows">
          <div class="row" $for="row in state.rows" $key="row.id" $class="{ picked: row.id === state.picked, base: !row.kind, dim: !row.kind }" @click="pick(row.id)" @dblclick="createRow(row)">
            <span class="indent" $for="n in row.depth" $key="n"></span>
            <span class="twisty" $class="{ hidden: !row.hasChildren, open: row.expanded }" @click="toggle($event, row)">▸</span>
            <span class="icon" $html="row.icon"></span>
            <span class="label">{{ row.label }}</span>
          </div>
        </div>
        <div class="description">
          <template $if="state.pickedNode">
            <p class="class"><span class="icon" $html="state.pickedNode.icon"></span><b>{{ state.pickedNode.label }}</b><span class="chain" $if="state.chain"> &lt; {{ state.chain }}</span></p>
            <p>{{ state.pickedNode.description || (state.pickedNode.kind ? '' : 'A base class: pick one of the kinds under it.') }}</p>
          </template>
          <p class="hint" $else>Pick a kind.</p>
        </div>
      </section>
    </div>
    <footer class="dialog-actions">
      <span class="dialog-keys">↑↓ move · ↵ create · Esc cancel</span>
      <button class="button large" @click="close()">Cancel</button>
      <button class="button large primary" $disabled="!state.pickedNode || !state.pickedNode.kind" @click="create()">Create</button>
    </footer>
  </div>
</div>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

interface KindNode { id: string; label: string; icon: string; description: string; kind: string | null; children: KindNode[] }
interface Row extends KindNode { depth: number; hasChildren: boolean; expanded: boolean }

const RECENT_KEY = 'catalyst-editor:recent-kinds'
const RECENT_MAX = 8

const open = shared('editor:addDialog', false)
const kinds = shared('editor:kinds', [])

const state = reactive({
  search: '',
  rows: [] as Row[],
  picked: null as string | null,
  pickedNode: null as KindNode | null,
  chain: '',
  recent: [] as KindNode[],
})
const collapsed = new Set<string>()
let all: KindNode[] = []
const parents = new Map<string, KindNode>()

function index(nodes: KindNode[], parent: KindNode | null) {
  for (const node of nodes) {
    if (parent) parents.set(node.id, parent)
    index(node.children, node)
  }
}

function byId(id: string | null): KindNode | null {
  if (!id) return null
  const find = (nodes: KindNode[]): KindNode | null => {
    for (const node of nodes) {
      if (node.id === id) return node
      const hit = find(node.children)
      if (hit) return hit
    }
    return null
  }
  return find(all)
}

function matches(node: KindNode, needle: string): boolean {
  return node.label.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle)
}

function hasMatch(node: KindNode, needle: string): boolean {
  return matches(node, needle) || node.children.some((child) => hasMatch(child, needle))
}

function refresh() {
  const needle = state.search.trim().toLowerCase()
  const rows: Row[] = []
  const visit = (node: KindNode, depth: number) => {
    if (needle && !hasMatch(node, needle)) return
    const expanded = needle ? true : !collapsed.has(node.id)
    rows.push({ ...node, depth, hasChildren: node.children.length > 0, expanded })
    if (expanded) node.children.forEach((child) => visit(child, depth + 1))
  }
  all.forEach((node) => visit(node, 0))
  state.rows = rows
  if (needle) {
    const current = rows.find((row) => row.id === state.picked)
    if (!current || !matches(current, needle)) {
      const first = rows.find((row) => row.kind && matches(row, needle)) ?? rows.find((row) => row.kind)
      pick(first?.id ?? null)
    }
  }
}

function pick(id: string | null) {
  state.picked = id
  state.pickedNode = byId(id)
  const chain: string[] = []
  let parent = id ? parents.get(id) : undefined
  while (parent) {
    chain.push(parent.label)
    parent = parents.get(parent.id)
  }
  state.chain = chain.join(' < ')
}

function toggle(event: Event, row: Row) {
  event.stopPropagation()
  if (collapsed.has(row.id)) collapsed.delete(row.id)
  else collapsed.add(row.id)
  refresh()
}

function loadRecent() {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]
    state.recent = ids.map((id) => byId(id)).filter((node): node is KindNode => node !== null)
  } catch {
    state.recent = []
  }
}

function remember(id: string) {
  const ids = [id, ...state.recent.map((node) => node.id).filter((other) => other !== id)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids))
  } catch {}
  loadRecent()
}

function create() {
  const node = state.pickedNode
  if (!node?.kind) return
  sendCommand({ type: 'add', kind: node.kind })
  remember(node.id)
  close()
}

function createRow(row: Row) {
  pick(row.id)
  create()
}

function close() {
  open.set(false)
}

function key(event: KeyboardEvent) {
  if (event.key === 'Enter') create()
  if (event.key === 'Escape') close()
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const addable = state.rows.filter((row) => row.kind)
    const at = addable.findIndex((row) => row.id === state.picked)
    const next = addable[Math.max(0, Math.min(addable.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]
    if (next) pick(next.id)
  }
}

kinds.subscribe((next: KindNode[]) => {
  all = next ?? []
  parents.clear()
  index(all, null)
  loadRecent()
  refresh()
})

open.subscribe((isOpen: boolean) => {
  if (!isOpen) return
  state.search = ''
  loadRecent()
  refresh()
  if (!state.pickedNode) pick(state.recent[0]?.id ?? state.rows.find((row) => row.kind)?.id ?? null)
  setTimeout(() => (document.querySelector('.dialog .search') as HTMLInputElement | null)?.focus(), 0)
})

document.addEventListener('keydown', (event) => {
  if (open.value && event.key === 'Escape') close()
})
</logic>

<style>
.scrim {
  z-index: 1200;
}

.dialog {
  max-width: 760px;
  height: min(560px, 86vh);
}

.body {
  flex: 1 1 0;
  display: flex;
  min-height: 0;
}

.recent {
  flex: 0 0 180px;
  padding-right: var(--cat-space-4);
  border-right: 1px solid var(--cat-border);
  overflow-y: auto;
}

h3 {
  margin-bottom: var(--cat-space-1-5);
}

.matches {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding-left: var(--cat-space-4);
  gap: var(--cat-space-2);
}

.rows {
  flex: 1 1 0;
  overflow-y: auto;
  border: 1px solid var(--cat-border);
  user-select: none;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1);
  width: 100%;
  padding: var(--cat-space-0-5) var(--cat-space-1-5);
  cursor: pointer;
  white-space: nowrap;
  box-sizing: border-box;
}

.row.flat {
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  text-align: left;
  border-radius: var(--cat-radius-sm);
}

.row:hover {
  background: var(--cat-bg-hover);
}

.row.picked {
  background: var(--cat-accent-soft);
}

.row.dim .label {
  color: var(--cat-text-tertiary);
}

.indent {
  display: inline-block;
  width: 14px;
}

.twisty {
  display: inline-block;
  width: 12px;
  color: var(--cat-text-tertiary);
  transition: transform 0.1s;
}

.twisty.open {
  transform: rotate(90deg);
}

.twisty.hidden {
  visibility: hidden;
}

.icon {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  color: var(--cat-text-secondary);
}

.icon :global(svg) {
  display: block;
  width: 14px;
  height: 14px;
}

.description {
  flex: 0 0 auto;
  min-height: 58px;
  padding: var(--cat-space-2) var(--cat-space-2);
  background: var(--cat-bg-app);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  color: var(--cat-text-secondary);
}

.description p {
  margin: var(--cat-space-0-5) 0;
}

.description .class {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1-5);
  color: var(--cat-text-primary);
}

.chain {
  color: var(--cat-text-tertiary);
}

.hint {
  color: var(--cat-text-tertiary);
  margin: var(--cat-space-0-5) 0;
}
</style>
