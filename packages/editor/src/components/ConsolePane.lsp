<view>
<div class="console-pane">
  <div class="bar">
    <div class="levels" role="group" aria-label="Show">
      <button type="button" class="level-toggle error" $aria-pressed="state.show.error" @click="toggle('error')">Errors <span class="mono">{{ state.counts.error }}</span></button>
      <button type="button" class="level-toggle warn" $aria-pressed="state.show.warn" @click="toggle('warn')">Warnings <span class="mono">{{ state.counts.warn }}</span></button>
      <button type="button" class="level-toggle" $aria-pressed="state.show.log" @click="toggle('log')">Logs <span class="mono">{{ state.counts.log }}</span></button>
      <button type="button" class="level-toggle" $aria-pressed="state.show.engine" @click="toggle('engine')">Engine <span class="mono">{{ state.counts.engine }}</span></button>
    </div>
    <input class="well filter" type="search" placeholder="Filter" aria-label="Filter the console" $model="state.filter" @input="refilter()" />
    <button class="button small" type="button" $disabled="!state.entries.length" @click="clear()">Clear</button>
  </div>
  <div class="body" $ref="body" @scroll="scrolled()">
    <p class="hint" $if="!state.entries.length">What the run window's console says shows here: logs, warnings, errors with where they were thrown, and the engine's own messages. Each run (⌘R) starts it afresh.</p>
    <div class="line" $for="line in state.shown" $key="line.key" $class="{ error: line.level === 'error', warn: line.level === 'warn', quiet: line.level === 'debug' || line.level === 'engine', expandable: Boolean(line.stack) }" @click="expand(line)">
      <span class="time mono">{{ line.at.toFixed(2) }}s</span>
      <span class="tag mono" $if="line.tag">{{ line.tag }}</span>
      <span class="text mono">{{ line.text }}</span>
      <span class="count mono" $if="line.count">{{ line.count }}</span>
      <span class="more" $if="line.stack" aria-hidden="true">{{ line.open ? '▾' : '▸' }}</span>
      <div class="stack mono" $if="line.open && line.stack">{{ line.stack }}</div>
    </div>
  </div>
</div>
</view>

<logic lang="ts">
import { reactive, shared, defineRefs } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { storage } from '../preferences.ts'

interface Entry { at: number; level: 'error' | 'warn' | 'log' | 'info' | 'debug' | 'engine'; text: string; tag?: string; stack?: string; count?: number }
type Shown = 'error' | 'warn' | 'log' | 'engine'

const SHOW_KEY = 'console-show'
const cell = shared('editor:console', [])
const refs = defineRefs<{ body: HTMLElement }>()
const state = reactive({
  entries: [] as Entry[],
  shown: [] as (Entry & { key: number; open: boolean })[],
  filter: '',
  show: { error: true, warn: true, log: true, engine: true, ...storage.get<Partial<Record<Shown, boolean>>>(SHOW_KEY, {}) } as Record<Shown, boolean>,
  counts: { error: 0, warn: 0, log: 0, engine: 0 } as Record<Shown, number>,
})

const groupOf = (entry: Entry): Shown => (entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : entry.level === 'engine' ? 'engine' : 'log')
const opened = new Set<number>()

function refilter() {
  const filter = state.filter.trim().toLowerCase()
  const counts = { error: 0, warn: 0, log: 0, engine: 0 }
  const shown: (Entry & { key: number; open: boolean })[] = []
  state.entries.forEach((entry, key) => {
    const group = groupOf(entry)
    counts[group] += entry.count ?? 1
    if (!state.show[group]) return
    if (filter && !`${entry.tag ?? ''} ${entry.text} ${entry.stack ?? ''}`.toLowerCase().includes(filter)) return
    shown.push({ ...entry, key, open: opened.has(key) })
  })
  state.counts = counts
  state.shown = shown
}

// Follows what is said while scrolled to the end, and stays put once scrolled back.
let following = true
function scrolled() {
  const body = refs.body
  if (body) following = body.scrollTop + body.clientHeight >= body.scrollHeight - 4
}

cell.subscribe((next: Entry[] | undefined) => {
  const entries = next ?? []
  if (entries.length < state.entries.length || (entries.length && entries[0] !== state.entries[0])) opened.clear()
  state.entries = entries
  refilter()
  if (!following) return
  requestAnimationFrame(() => {
    const body = refs.body
    if (body) body.scrollTop = body.scrollHeight
  })
})

function toggle(group: Shown) {
  state.show = { ...state.show, [group]: !state.show[group] }
  storage.set(SHOW_KEY, state.show)
  refilter()
}

function expand(line: { key: number; stack?: string }) {
  if (!line.stack) return
  if (opened.has(line.key)) opened.delete(line.key)
  else opened.add(line.key)
  refilter()
}

function clear() {
  sendCommand({ type: 'clearConsole' })
}
</logic>

<style>
.console-pane {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--cat-bg-panel);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / var(--cat-leading-body) var(--cat-font-ui);
}

.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--cat-space-2);
  padding: var(--cat-space-1) var(--cat-space-2);
  border-bottom: 1px solid var(--cat-border-subtle);
}

.levels {
  display: flex;
  gap: var(--cat-space-1);
}

.level-toggle {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1);
  height: 22px;
  padding: 0 var(--cat-space-2);
  border: 1px solid var(--cat-border-subtle);
  border-radius: var(--cat-radius-sm);
  background: none;
  color: var(--cat-text-tertiary);
  font: inherit;
  font-size: var(--cat-text-xs);
  white-space: nowrap;
  cursor: pointer;
}

.level-toggle[aria-pressed="true"] {
  border-color: var(--cat-border);
  background: var(--cat-bg-raised);
  color: var(--cat-text-primary);
}

.level-toggle.error[aria-pressed="true"] .mono {
  color: var(--cat-danger);
}

.level-toggle.warn[aria-pressed="true"] .mono {
  color: var(--cat-warning);
}

.filter {
  flex: 1 1 8rem;
  min-width: 8rem;
}

.body {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--cat-space-1) 0 var(--cat-space-3);
}

.hint {
  margin: var(--cat-space-2) var(--cat-space-3);
  color: var(--cat-text-tertiary);
}

.mono {
  font-family: var(--cat-font-mono);
}

.line {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--cat-space-2);
  padding: var(--cat-space-0-5) var(--cat-space-3);
  border-bottom: 1px solid var(--cat-border-subtle);
  font-size: var(--cat-text-xs);
}

.line.error {
  background: var(--cat-danger-surface);
  color: var(--cat-danger);
}

.line.warn {
  background: var(--cat-warning-surface);
  color: var(--cat-warning);
}

.line.quiet .text {
  color: var(--cat-text-secondary);
}

.line.expandable {
  cursor: pointer;
}

.more {
  color: var(--cat-text-tertiary);
}

.time {
  flex: 0 0 4.5em;
  color: var(--cat-text-tertiary);
}

.tag {
  color: var(--cat-text-tertiary);
}

.tag::before {
  content: "[";
}

.tag::after {
  content: "]";
}

.text {
  flex: 1 1 0;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.count {
  padding: 0 var(--cat-space-1-5);
  border-radius: 999px;
  background: var(--cat-bg-raised);
  color: var(--cat-text-secondary);
}

.stack {
  flex: 1 1 100%;
  margin: var(--cat-space-1) 0 0 calc(4.5em + var(--cat-space-2));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--cat-text-secondary);
}
</style>
