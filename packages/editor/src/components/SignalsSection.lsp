<view>
<template $if="shared['editor:signals'] && shared['editor:selection'] && shared['editor:selection'].count === 1">
  <section class="section">
    <button class="section-header" type="button" $aria-expanded="state.signalsOpen" @click="state.signalsOpen = !state.signalsOpen"><span class="title">Signals</span><span class="count">{{ shared['editor:signals'].signals.length }}</span></button>
    <div class="section-body" $if="state.signalsOpen">
      <div class="signal" $for="signal in shared['editor:signals'].signals" $key="signal.name" $class="{ common: signal.common && !signal.listeners.length }">
        <div class="signal-head">
          <span class="signal-name mono" $title="signal.description || signal.name">{{ signal.name }}</span>
          <span class="payload mono" $if="signal.payload">{{ signal.payload }}</span>
          <span class="from-script mono" $if="signal.url" $title="'Declared in ' + signal.url">{{ fileName(signal.url) }}</span>
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
  <section class="section">
    <button class="section-header" type="button" $aria-expanded="state.listensOpen" @click="state.listensOpen = !state.listensOpen"><span class="title">Listens to</span><span class="count">{{ shared['editor:signals'].listens.length }}</span></button>
    <div class="section-body" $if="state.listensOpen">
      <span class="hint" $if="!shared['editor:signals'].listens.length">Nothing yet: its scripts' methods can be called by signals from other nodes or the engine.</span>
      <div class="wire" $for="row in shared['editor:signals'].listens" $key="row.url + ':' + row.index + ':' + row.signal + ':' + row.call" $class="{ broken: row.problem }">
        <button class="link" type="button" $if="row.source !== null && row.from !== '.'" $title="'Select ' + row.from" @click="select(row.source)">{{ row.from }}</button>
        <span class="source" $else-if="row.from === '.'">itself</span>
        <span class="source" $else-if="row.from === undefined">engine</span>
        <span class="source missing" $else>{{ row.from }}</span>
        <span class="signal-name mono">{{ row.signal }}</span>
        <span class="arrow" aria-hidden="true">→</span>
        <button class="link mono" type="button" $title="'Open ' + row.url" @click="open(row.url)">{{ row.call }}()</button>
        <span class="problem" $if="row.problem">{{ row.problem }}</span>
        <button class="icon-button small" type="button" $if="row.index !== null" title="Disconnect" aria-label="Disconnect" @click="disconnect(row)">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>
        </button>
      </div>
      <div class="buttons">
        <button class="button small" type="button" @click="listen()">Listen to…</button>
      </div>
    </div>
  </section>
</template>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

interface Row { url: string; index: number | null; node: number; call: string }

const view = shared('editor:signals', null)
const state = reactive({ signalsOpen: true, listensOpen: true, newSignal: '', addTitle: '' })

view.subscribe((next: { scripts: { url: string }[] } | null | undefined) => {
  state.addTitle = next?.scripts.length ? `Declared in ${next.scripts[0].url}` : 'A script is made for the node to declare it in'
})

const fileName = (url: string) => url.replace(/^.*\//, '')

function connect(signal: string) {
  sendCommand({ type: 'openConnect', mode: 'emit', signal })
}

function listen() {
  sendCommand({ type: 'openConnect', mode: 'listen' })
}

function select(id: number) {
  sendCommand({ type: 'select', id })
}

function open(url: string) {
  sendCommand({ type: 'openScript', path: url })
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

.payload,
.from-script {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.from-script {
  flex: 0 1 auto;
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

.source {
  color: var(--cat-text-tertiary);
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

.wire .icon-button {
  margin-left: auto;
}

.wire.broken .signal-name,
.source.missing {
  color: var(--cat-danger);
}

.hint {
  color: var(--cat-text-tertiary);
}

.attach {
  display: flex;
  gap: var(--cat-space-1);
}

.attach > .well {
  flex: 1 1 auto;
}

.buttons {
  display: flex;
  gap: var(--cat-space-1);
}
</style>
