<view>
<div class="signals-pane">
  <div class="bar">
    <div class="segmented" role="tablist" aria-label="Signals view">
      <button type="button" role="tab" $aria-selected="state.tab === 'scene'" $aria-checked="state.tab === 'scene'" @click="show('scene')">Scene</button>
      <button type="button" role="tab" $aria-selected="state.tab === 'engine'" $aria-checked="state.tab === 'engine'" @click="show('engine')">Engine</button>
      <button type="button" role="tab" $aria-selected="state.tab === 'log'" $aria-checked="state.tab === 'log'" @click="show('log')">Log</button>
    </div>
    <input class="well filter" type="search" placeholder="Filter" aria-label="Filter signals" $model="state.filter" @input="refilter()" />
    <span class="count mono" $if="state.tab === 'log' && state.log.length">{{ state.log.length }}</span>
    <button class="button small" type="button" $if="state.tab === 'log'" $disabled="!state.log.length" @click="clear()">Clear</button>
  </div>

  <div class="body" $ref="body" @scroll="scrolled()">
    <template $if="state.tab === 'scene'">
      <h3 class="group">Connections <span class="count">{{ state.connections.length }}</span></h3>
      <p class="hint" $if="!state.browser.connections.length">No connections yet. Select a node and use + beside one of its signals in the inspector, or write <span class="mono">static connections</span> in a script.</p>
      <div class="row" $for="row in state.connections" $key="row.url + ':' + row.index + ':' + row.node + ':' + row.signal + ':' + row.call" $class="{ broken: row.problem }">
        <button class="link" type="button" $if="row.source !== null" @click="select(row.source)">{{ row.from === '.' ? row.nodeName : row.from }}</button>
        <span class="dim" $else>{{ row.from === undefined ? 'engine' : row.from }}</span>
        <span class="mono signal">{{ row.signal }}</span>
        <span class="dim">→</span>
        <button class="link" type="button" @click="select(row.node)">{{ row.nodeName }}</button>
        <button class="link mono" type="button" $title="'Open ' + row.url" @click="open(row.url)">{{ row.call }}()</button>
        <span class="problem" $if="row.problem">{{ row.problem }}</span>
      </div>
      <h3 class="group">Signals declared by scripts <span class="count">{{ state.declared.length }}</span></h3>
      <p class="hint" $if="!state.browser.declared.length">None: a script adds signals to its node with <span class="mono">static signals</span>, or Add in the inspector writes one.</p>
      <div class="row" $for="signal in state.declared" $key="signal.node + ':' + signal.name">
        <button class="link" type="button" @click="select(signal.node)">{{ signal.nodeName }}</button>
        <span class="mono signal">{{ signal.name }}</span>
        <button class="link mono dim" type="button" $title="'Open ' + signal.url" @click="open(signal.url)">{{ fileName(signal.url) }}</button>
        <span class="dim">{{ signal.listeners === 1 ? '1 listener' : signal.listeners + ' listeners' }}</span>
      </div>
    </template>

    <template $if="state.tab === 'engine'">
      <div class="engine-group" $for="group in state.engine" $key="group.group || 'engine'">
        <h3 class="group">{{ group.group ? 'engine.signals.' + group.group : 'engine.signals' }}</h3>
        <div class="engine-signal" $for="signal in group.signals" $key="signal.name">
          <div class="row">
            <span class="mono signal">{{ signal.name }}</span>
            <span class="mono dim" $if="signal.payload">{{ signal.payload }}</span>
          </div>
          <p class="description" $if="signal.description">{{ signal.description }}</p>
          <div class="row listener" $for="row in signal.listeners" $key="row.url + ':' + row.index + ':' + row.node">
            <span class="dim">→</span>
            <button class="link" type="button" @click="select(row.node)">{{ row.nodeName }}</button>
            <button class="link mono" type="button" @click="open(row.url)">{{ row.call }}()</button>
          </div>
        </div>
      </div>
    </template>

    <template $if="state.tab === 'log'">
      <p class="hint" $if="!shared['editor:signalLog'].length">Signals show here as they fire while the scene runs (⌘R). Those that fire every frame, such as onUpdate and physics.onStep, are left out.</p>
      <div class="log-row mono" $for="entry in state.shown" $key="entry.key">
        <span class="time">{{ entry.at.toFixed(2) }}s</span>
        <span class="node" $title="entry.node || 'engine'">{{ entry.node || 'engine' }}</span>
        <span class="signal">{{ entry.signal }}</span>
        <span class="value" $title="entry.value">{{ entry.value }}</span>
      </div>
    </template>
  </div>
</div>
</view>

<logic lang="ts">
import { reactive, shared, defineRefs } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { storage } from '../preferences.ts'

interface Row { url: string; index: number | null; node: number; nodeName: string; from?: string; source: number | null; signal: string; call: string; problem: string | null }
interface Browser { connections: Row[]; declared: { node: number; nodeName: string; name: string; url: string; listeners: number }[]; engine: { group: string | null; signals: { name: string; description?: string; payload?: string; listeners: Row[] }[] }[] }
interface Fired { at: number; node: string | null; signal: string; value: string }

const TAB_KEY = 'signals-tab'
const browser = shared('editor:signalBrowser', { connections: [], declared: [], engine: [] })
const fired = shared('editor:signalLog', [])
const refs = defineRefs<{ body: HTMLElement }>()
const state = reactive({
  tab: storage.get<string>(TAB_KEY, 'scene'),
  filter: '',
  browser: { connections: [], declared: [], engine: [] } as Browser,
  log: [] as Fired[],
  connections: [] as Row[],
  declared: [] as Browser['declared'],
  engine: [] as Browser['engine'],
  shown: [] as (Fired & { key: number })[],
})

const fileName = (url: string) => url.replace(/^.*\//, '')
const matches = (...parts: (string | null | undefined)[]) => {
  const filter = state.filter.trim().toLowerCase()
  return !filter || parts.some((part) => part?.toLowerCase().includes(filter))
}

function refilter() {
  state.connections = state.browser.connections.filter((row) => matches(row.from, row.signal, row.nodeName, row.call))
  state.declared = state.browser.declared.filter((signal) => matches(signal.nodeName, signal.name, signal.url))
  state.engine = state.browser.engine
    .map((group) => ({ ...group, signals: group.signals.filter((signal) => matches(group.group, signal.name, signal.description)) }))
    .filter((group) => group.signals.length)
  state.shown = state.log.map((entry, key) => ({ ...entry, key })).filter((entry) => matches(entry.node ?? 'engine', entry.signal, entry.value))
}

browser.subscribe((next: Browser | undefined) => {
  state.browser = next ?? { connections: [], declared: [], engine: [] }
  refilter()
})

// The log follows what fires while it is scrolled to its end, and stays put once scrolled back.
let following = true
function scrolled() {
  const body = refs.body
  if (body) following = body.scrollTop + body.clientHeight >= body.scrollHeight - 4
}
fired.subscribe((next: Fired[] | undefined) => {
  state.log = next ?? []
  refilter()
  if (state.tab !== 'log' || !following) return
  requestAnimationFrame(() => {
    const body = refs.body
    if (body) body.scrollTop = body.scrollHeight
  })
})

function show(tab: string) {
  state.tab = tab
  storage.set(TAB_KEY, tab)
  following = true
}

function select(id: number) {
  sendCommand({ type: 'select', id })
}

function open(url: string) {
  sendCommand({ type: 'openScript', path: url })
}

function clear() {
  sendCommand({ type: 'clearSignalLog' })
}
</logic>

<style>
.signals-pane {
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
  align-items: center;
  gap: var(--cat-space-2);
  padding: var(--cat-space-1) var(--cat-space-2);
  border-bottom: 1px solid var(--cat-border-subtle);
}

.filter {
  flex: 1 1 auto;
  min-width: 0;
}

.bar .segmented {
  flex: 0 0 auto;
  white-space: nowrap;
}

.bar .count {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.body {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding: var(--cat-space-1) var(--cat-space-3) var(--cat-space-3);
}

.group {
  display: flex;
  gap: var(--cat-space-1-5);
  margin: var(--cat-space-3) 0 var(--cat-space-1);
  color: var(--cat-text-secondary);
  font: 600 var(--cat-text-xs) / var(--cat-leading-tight) var(--cat-font-ui);
  letter-spacing: var(--cat-tracking-section);
  text-transform: uppercase;
}

.group .count {
  color: var(--cat-text-tertiary);
  font-family: var(--cat-font-mono);
}

.hint {
  margin: 0;
  color: var(--cat-text-tertiary);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1-5);
  min-width: 0;
  min-height: 22px;
  white-space: nowrap;
}

.row.listener {
  padding-left: var(--cat-space-3);
}

.mono {
  font-family: var(--cat-font-mono);
}

.dim {
  color: var(--cat-text-tertiary);
}

.signal {
  color: var(--cat-text-primary);
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--cat-text-secondary);
  font: inherit;
  cursor: pointer;
}

.link.mono {
  font-family: var(--cat-font-mono);
}

.link:hover {
  color: var(--cat-text-primary);
  text-decoration: underline;
}

.problem {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--cat-danger);
  font-size: var(--cat-text-xs);
}

.broken .signal {
  color: var(--cat-danger);
}

.engine-signal {
  padding: var(--cat-space-0-5) 0;
}

.description {
  margin: 0;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.log-row {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.4fr);
  gap: var(--cat-space-2);
  min-height: 20px;
  align-items: center;
  font-size: var(--cat-text-xs);
}

.log-row > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-row .time,
.log-row .value {
  color: var(--cat-text-tertiary);
}

.log-row .node {
  color: var(--cat-text-secondary);
}
</style>
