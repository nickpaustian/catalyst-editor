<view>
<template $if="shared['editor:signals'] && shared['editor:selection'] && shared['editor:selection'].count === 1">
  <section class="section">
    <button class="section-header" type="button" $aria-expanded="state.signalsOpen" @click="state.signalsOpen = !state.signalsOpen"><span class="title">Signals</span><span class="count">{{ shared['editor:signals'].signals.length }}</span></button>
    <div class="section-body" $if="state.signalsOpen">
      <p class="lead">Signals belong to the node: anything can hear them. Its scripts can add more.</p>
      <div class="signal" $for="signal in state.signals" $key="signal.name" $class="{ common: signal.common && !signal.listeners.length }">
        <h4 class="origin" $if="signal.first">{{ signal.origin === 'every node' ? 'Every node has' : 'From ' + signal.origin }}</h4>
        <div class="signal-head">
          <span class="signal-name mono" $title="signal.description || signal.name">{{ signal.name }}</span>
          <span class="payload mono" $if="signal.payload">{{ signal.payload }}</span>
          <button class="icon-button small" type="button" title="Connect to a method" $aria-label="'Connect ' + signal.name" @click="connect(signal.name)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>
          </button>
          <button class="icon-button small" type="button" $if="signal.url && signal.index !== null" title="Remove the signal from its script" $aria-label="'Remove ' + signal.name" @click="removeSignal(signal)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>
          </button>
        </div>
        <div class="wire" $for="row in signal.listeners" $key="row.url + ':' + row.index + ':' + row.node" $class="{ broken: row.problem }">
          <span class="arrow" aria-hidden="true">→</span>
          <button class="link" type="button" $title="'Select ' + row.nodeName" @click="select(row.node)">{{ row.nodeName }}</button>
          <button class="link mono" type="button" $title="'Open ' + row.url" @click="open(row.url)">{{ row.call }}()</button>
          <span class="problem" $if="row.problem">{{ row.problem }}</span>
          <button class="icon-button small edit" type="button" $if="row.index !== null" title="Change the connection" aria-label="Change the connection" @click="editConnection(row)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3-8 8H2.5v-3z"/></svg>
          </button>
          <button class="icon-button small" type="button" $if="row.index !== null" title="Disconnect" aria-label="Disconnect" @click="disconnect(row)">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>
          </button>
        </div>
      </div>
      <form class="attach" @submit="addSignal($event)">
        <input class="well" type="text" spellcheck="false" placeholder="New signal name" aria-label="New signal name" $model="state.newSignal" />
        <button class="button small" type="submit" $disabled="!state.newSignal.trim()" $title="state.addTitle">Add</button>
      </form>
    </div>
  </section>
</template>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

interface Row { url: string; index: number | null; node: number; call: string }

const view = shared('editor:signals', null)
interface SignalRow { name: string; origin: string; first?: boolean }
const state = reactive({ signalsOpen: true, newSignal: '', addTitle: '', signals: [] as SignalRow[] })

view.subscribe((next: { scripts: { url: string }[]; signals: SignalRow[] } | null | undefined) => {
  state.addTitle = next?.scripts.length ? `Declared in ${next.scripts[0].url}` : 'A script is made for the node to declare it in'
  state.signals = (next?.signals ?? []).map((signal, i, all) => ({ ...signal, first: i === 0 || all[i - 1].origin !== signal.origin }))
})

const fileName = (url: string) => url.replace(/^.*\//, '')

function connect(signal: string) {
  sendCommand({ type: 'openConnect', mode: 'emit', signal })
}

function select(id: number) {
  sendCommand({ type: 'select', id })
}

function open(url: string) {
  sendCommand({ type: 'openScript', path: url })
}

function editConnection(row: Row) {
  if (row.index !== null) sendCommand({ type: 'openConnect', mode: 'listen', node: row.node, edit: { url: row.url, index: row.index } })
}

function disconnect(row: Row) {
  if (row.index !== null) sendCommand({ type: 'disconnectSignal', url: row.url, index: row.index })
}

function removeSignal(signal: { url: string | null; index: number | null }) {
  if (signal.url && signal.index !== null) sendCommand({ type: 'removeSignal', url: signal.url, index: signal.index })
}

function addSignal(event: Event) {
  event.preventDefault()
  const current = view.value as { node: number; scripts: { url: string }[] } | null
  const name = state.newSignal.trim()
  if (!current || !name) return
  sendCommand({ type: 'addSignal', node: current.node, url: current.scripts[0]?.url ?? null, name })
  state.newSignal = ''
}
</logic>

<style>
.lead {
  margin: 0;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.origin {
  margin: var(--cat-space-1) 0 0;
  color: var(--cat-text-tertiary);
  font: 500 var(--cat-text-xs) / var(--cat-leading-tight) var(--cat-font-ui);
}

.signal {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-0-5);
}

.signal-head,
.wire {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1-5);
  min-width: 0;
  min-height: 22px;
}

.signal-name {
  color: var(--cat-text-primary);
}

.signal-head .signal-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.common .signal-name {
  color: var(--cat-text-tertiary);
}

.payload {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.signal-head .icon-button:first-of-type {
  margin-left: auto;
}

.wire {
  padding-left: var(--cat-space-3);
  color: var(--cat-text-secondary);
}

.signal-head + .wire {
  margin-top: calc(-1 * var(--cat-space-0-5));
}

.arrow {
  color: var(--cat-text-tertiary);
}

.link {
  padding: 0;
  border: 0;
  background: none;
  color: var(--cat-text-secondary);
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.link.mono {
  font-family: var(--cat-font-mono);
}

.link:hover {
  color: var(--cat-text-primary);
  text-decoration: underline;
}

.problem {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cat-danger);
  font-size: var(--cat-text-xs);
}

.wire .edit {
  margin-left: auto;
}

.wire.broken .signal-name {
  color: var(--cat-danger);
}

.attach {
  display: flex;
  gap: var(--cat-space-1);
}

.attach > .well {
  flex: 1 1 auto;
}
</style>
