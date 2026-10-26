<view>
<div class="scrim" $if="state.open" @pointerdown="close()">
  <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="connect-title" @pointerdown="$event.stopPropagation()" @submit="submit($event)">
    <h2 class="dialog-title" id="connect-title">{{ state.title }}</h2>
    <p class="lead">The connection is written into the listening script's <span class="mono">static connections</span>, where it can be edited by hand too.</p>

    <template $if="state.mode === 'listen'">
      <label class="dialog-field">Signal from
        <span class="well large select">
          <select $model="state.source" @change="pickedSource()">
            <option value="engine" $selected="state.source === 'engine'">The engine</option>
            <option $for="tag in state.tags" $key="tag.tag" $value="'tag:' + tag.tag" $selected="'tag:' + tag.tag === state.source" $label="tag.label">{{ tag.label }}</option>
            <option $for="node in state.nodes" $key="node.id" $value="String(node.id)" $selected="String(node.id) === state.source" $label="node.label">{{ node.label }}</option>
          </select>
        </span>
      </label>
      <label class="dialog-field">Signal
        <span class="well large select">
          <select $model="state.signal" @change="suggest()">
            <option $for="name in state.signals" $key="name" $value="name" $selected="name === state.signal" $label="name">{{ name }}</option>
          </select>
        </span>
      </label>
    </template>

    <fieldset class="scope" $if="state.mode === 'emit' && state.sourceTags.length">
      <legend>Hear</legend>
      <label class="check">
        <input type="radio" name="group" value="" $checked="!state.group" @change="pickGroup('')" />
        <span>Only {{ state.sourceName }}</span>
      </label>
      <label class="check" $for="tag in state.sourceTags" $key="tag">
        <input type="radio" name="group" $value="tag" $checked="state.group === tag" @change="pickGroup(tag)" />
        <span>Every node tagged {{ tag }} <span class="dim">· as each comes and goes, with the one that sent it</span></span>
      </label>
    </fieldset>

    <label class="dialog-field" $if="state.mode === 'emit'">Listener
      <span class="well large select">
        <select $model="state.target" @change="pickedTarget()">
          <option $for="node in state.nodes" $key="node.id" $value="String(node.id)" $selected="String(node.id) === state.target" $label="node.label">{{ node.label }}</option>
        </select>
      </span>
    </label>

    <label class="dialog-field">Script
      <span class="well large select">
        <select $model="state.script" $disabled="state.editing" @change="pickedScript()">
          <option $for="script in state.scripts" $key="script.url" $value="script.url" $selected="script.url === state.script" $label="script.name">{{ script.name }}</option>
          <option value="" $selected="state.script === ''">New script for {{ state.targetName }}</option>
        </select>
      </span>
    </label>
    <fieldset class="scope" $if="state.hasSourceNode && state.script">
      <legend>Which nodes with {{ state.scriptName }} hear it</legend>
      <label class="check">
        <input type="radio" name="scope" value="node" $checked="state.perNode" @change="state.perNode = true" />
        <span>Only {{ state.targetName }} <span class="dim">· a <span class="mono">node</span> field on the script names {{ state.sourceName }}, and each node sets its own</span></span>
      </label>
      <label class="check">
        <input type="radio" name="scope" value="all" $checked="!state.perNode" @change="state.perNode = false" />
        <span>Every node with it <span class="dim">· {{ state.sourceName }} is written into the script{{ state.shared > 1 ? ', for all ' + state.shared : '' }}</span></span>
      </label>
    </fieldset>

    <label class="dialog-field">Method
      <span class="well large select">
        <select $model="state.method">
          <option $for="method in state.methods" $key="method" $value="method" $selected="method === state.method" $label="method + '()'">{{ method }}()</option>
          <option value="" $selected="state.method === ''">New method…</option>
        </select>
      </span>
    </label>
    <label class="dialog-field" $if="state.method === ''">New method's name
      <input class="well large mono" type="text" spellcheck="false" $model="state.newMethod" />
    </label>

    <p class="error" $if="state.error">{{ state.error }}</p>

    <footer class="dialog-actions">
      <span class="dialog-keys">↵ {{ state.editing ? 'save' : 'connect' }} · Esc cancel</span>
      <button class="button large" type="button" @click="close()">Cancel</button>
      <button class="button large primary" type="submit" $disabled="!state.signal || !state.target || (state.method === '' && !state.newMethod.trim())">{{ state.editing ? 'Save' : 'Connect' }}</button>
    </footer>
  </form>
</div>
</view>

<logic lang="ts">
import { reactive, shared, onMounted } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { CONNECT_DEFAULT } from '../SignalWiring.ts'

interface ConnectNode { id: number; label: string; tags: string[]; signals: string[]; scripts: { url: string; name: string; methods: string[]; shared: number }[] }
interface Edit { url: string; index: number; call: string; perNode: boolean }
interface ConnectTag { tag: string; label: string; signals: string[] }
interface Dialog { open: boolean; mode: 'emit' | 'listen'; source: number | null; signal: string; target: number | null; script: string | null; edit: Edit | null; group: string | null; nodes: ConnectNode[]; tags: ConnectTag[]; engine: { name: string }[]; error: string }

const cell = shared('editor:connect', CONNECT_DEFAULT)
const state = reactive({
  open: false,
  mode: 'emit' as 'emit' | 'listen',
  title: '',
  nodes: [] as ConnectNode[],
  source: '',
  signal: '',
  signals: [] as string[],
  target: '',
  targetName: '',
  scripts: [] as ConnectNode['scripts'],
  script: '',
  scriptName: '',
  shared: 0,
  methods: [] as string[],
  method: '',
  newMethod: '',
  error: '',
  perNode: false,
  editing: false,
  hasSourceNode: false,
  sourceName: '',
  tags: [] as ConnectTag[],
  sourceTags: [] as string[],
  group: '',
})

let engineSignals: string[] = []
let shownFor: Dialog | null = null

const nodeOf = (id: string) => state.nodes.find((node) => String(node.id) === id) ?? null
const lastPart = (label: string) => label.replace(/^.*\//, '')

// A method name from where the signal comes from and what it says: "Front button" and onPressed give frontButtonPressed.
function suggest() {
  const from = state.group || (state.mode === 'listen' ? (state.source === 'engine' ? '' : lastPart(nodeOf(state.source)?.label ?? '')) : lastPart(nodeOf(String(shownFor?.source))?.label ?? ''))
  const words = `${from} ${state.signal.replace(/^.*\./, '').replace(/^on(?=[A-Z])/, '')}`.trim().split(/[^A-Za-z0-9]+|(?=[A-Z])/).filter(Boolean)
  const name = words.map((word, i) => (i ? word[0].toUpperCase() + word.slice(1) : word.toLowerCase())).join('').replace(/^[^A-Za-z_$]+/, '')
  state.newMethod = name || 'onSignal'
}

// A connection from a node can be the script's for every node it is on, or chosen per node through a field; a script on several nodes leans to the second.
function scope() {
  const sourceId = state.mode === 'emit' ? String(shownFor?.source ?? '') : state.source
  const source = sourceId && sourceId !== 'engine' && !sourceId.startsWith('tag:') ? nodeOf(sourceId) : null
  state.sourceTags = state.mode === 'emit' ? source?.tags ?? [] : []
  if (state.mode === 'listen') state.group = sourceId.startsWith('tag:') ? sourceId.slice(4) : ''
  state.hasSourceNode = source !== null && !state.group
  state.sourceName = source ? lastPart(source.label) : ''
  state.perNode = state.shared > 1
}

function pickGroup(tag: string) {
  state.group = tag
  const source = nodeOf(String(shownFor?.source ?? ''))
  state.hasSourceNode = source !== null && !tag
  suggest()
}

function pickedSource() {
  const tag = state.source.startsWith('tag:') ? state.tags.find((each) => 'tag:' + each.tag === state.source) : null
  state.signals = state.source === 'engine' ? engineSignals : tag ? tag.signals : nodeOf(state.source)?.signals ?? []
  if (!state.signals.includes(state.signal)) state.signal = state.signals[0] ?? ''
  scope()
  suggest()
}

function pickedScript() {
  const script = state.scripts.find((each) => each.url === state.script)
  state.scriptName = script?.name ?? ''
  state.shared = script?.shared ?? 0
  state.methods = script?.methods ?? []
  state.method = ''
  scope()
}

function pickedTarget() {
  const node = nodeOf(state.target)
  state.targetName = node ? lastPart(node.label) : ''
  state.scripts = node?.scripts ?? []
  state.script = state.scripts[0]?.url ?? ''
  pickedScript()
}

cell.subscribe((next: Dialog | undefined) => {
  if (!next?.open) {
    state.open = false
    shownFor = null
    return
  }
  state.error = next.error
  if (shownFor && shownFor.source === next.source && shownFor.target === next.target && shownFor.mode === next.mode && shownFor.signal === next.signal && shownFor.edit?.index === next.edit?.index) return
  shownFor = next
  engineSignals = next.engine.map((info) => info.name)
  state.mode = next.mode
  state.nodes = next.nodes
  state.tags = next.tags
  state.group = ''
  if (next.mode === 'emit') {
    const source = next.nodes.find((node) => node.id === next.source)
    state.title = `Connect ${next.signal}${source ? ` from ${lastPart(source.label)}` : ''}`
    state.signal = next.signal
    state.target = String(next.target ?? next.nodes.find((node) => node.scripts.length && node.id !== next.source)?.id ?? next.source ?? '')
  } else {
    const target = next.nodes.find((node) => node.id === next.target)
    state.title = next.edit ? `Edit a connection of ${target ? lastPart(target.label) : 'a node'}` : `Listen from ${target ? lastPart(target.label) : 'a node'}`
    state.target = String(next.target ?? '')
    state.source = next.group ? `tag:${next.group}` : next.edit && next.source !== null ? String(next.source) : 'engine'
    pickedSource()
    if (next.edit) state.signal = next.signal
  }
  state.editing = next.edit !== null
  pickedTarget()
  if (next.script && state.scripts.some((script) => script.url === next.script)) {
    state.script = next.script
    pickedScript()
  }
  suggest()
  // An edit starts from what the connection does now: its method, and how it names its node.
  if (next.edit) {
    if (state.methods.includes(next.edit.call)) state.method = next.edit.call
    else state.newMethod = next.edit.call
    state.perNode = next.edit.perNode
  }
  state.open = true
  setTimeout(() => (document.querySelector('#connect-dialog select') as HTMLSelectElement | null)?.focus(), 0)
})

function submit(event: Event) {
  event.preventDefault()
  if (!state.signal || !state.target) return
  sendCommand({
    type: 'connectSignal',
    source: state.mode === 'emit' ? shownFor?.source ?? null : state.source === 'engine' || state.group ? null : Number(state.source),
    signal: state.signal,
    target: Number(state.target),
    url: state.script || null,
    call: state.method || state.newMethod.trim(),
    perNode: state.hasSourceNode && Boolean(state.script) && state.perNode,
    group: state.group || null,
    edit: shownFor?.edit ? { url: shownFor.edit.url, index: shownFor.edit.index } : null,
  })
}

function close() {
  sendCommand({ type: 'closeConnect' })
}

onMounted(() => {
  document.addEventListener('keydown', (event) => {
    if (state.open && event.key === 'Escape') close()
  })
})
</logic>

<style>
.scrim {
  z-index: 1300;
}

.dialog {
  width: min(30rem, calc(100vw - 2 * var(--cat-space-4)));
}

.lead {
  margin: 0;
  color: var(--cat-text-secondary);
}

.mono {
  font-family: var(--cat-font-mono);
}

.scope {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-1-5);
  margin: 0;
  padding: 0;
  border: 0;
}

.scope legend {
  margin-bottom: var(--cat-space-1);
  color: var(--cat-text-secondary);
}

.check {
  display: flex;
  align-items: baseline;
  gap: var(--cat-space-2);
  color: var(--cat-text-primary);
}

.dim {
  color: var(--cat-text-tertiary);
}

.error {
  margin: 0;
  color: var(--cat-danger);
}
</style>
