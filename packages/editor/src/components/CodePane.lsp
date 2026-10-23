<view>
<div class="code-pane">
  <div class="bar">
    <select class="file" $model="state.path" @change="choose()">
      <option value="">Choose a script…</option>
      <option $for="file in shared['editor:scripts']" $key="file.path" $value="file.path">{{ file.path }}</option>
    </select>
    <span class="dirty" $if="state.dirty">unsaved</span>
    <span class="status" $class="{ error: state.error }">{{ state.status }}</span>
    <button class="primary" $disabled="!state.path || !state.dirty" @click="save()">Save script</button>
  </div>
  <div class="host" $ref="host"></div>
  <p class="hint" $if="!state.path">Open a script from the inspector's Scripts section, or choose one above. Saving writes the file and rebuilds every script in the scene.</p>
</div>
</view>

<logic lang="ts">
import { reactive, shared, defineRefs, onMounted, onUnmounted } from '@lightspeed-js/core'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { sendCommand } from '../commands.ts'

interface Code { path: string | null; text: string; status: string }

const code = shared('editor:code', { path: null, text: '', status: '' })
shared('editor:scripts')
const saveRequest = shared('editor:saveRequest', 0)
const refs = defineRefs<{ host: HTMLElement }>()

const state = reactive({ path: '', dirty: false, status: '', error: false })

let view: EditorView | null = null
let shown = ''
const readOnly = new Compartment()

function save(): boolean {
  if (!view || !state.path) return false
  sendCommand({ type: 'saveScript', path: state.path, text: view.state.doc.toString() })
  return true
}

function saveAll(): boolean {
  sendCommand({ type: 'saveAll' })
  return true
}

saveRequest.subscribe((n: number | undefined) => {
  if (n && state.dirty) save()
})

function choose() {
  if (state.path) sendCommand({ type: 'openScript', path: state.path })
  else sendCommand({ type: 'closeScript' })
}

function show(next: Code) {
  if (!view) return
  const path = next.path ?? ''
  const replace = path !== state.path || (!state.dirty && next.text !== shown)
  state.path = path
  state.status = next.status
  state.error = Boolean(next.status) && !/^(saved|reloaded) /.test(next.status)
  if (replace || /^(saved|reloaded) /.test(next.status)) {
    if (replace) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next.text } })
    shown = next.text
    state.dirty = false
    view.dispatch({ effects: readOnly.reconfigure(EditorState.readOnly.of(!path)) })
  }
}

onMounted(() => {
  view = new EditorView({
    parent: refs.host,
    state: EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        keymap.of([{ key: 'Mod-s', run: saveAll }, indentWithTab]),
        javascript({ typescript: true }),
        oneDark,
        readOnly.of(EditorState.readOnly.of(true)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) state.dirty = update.state.doc.toString() !== shown
        }),
      ],
    }),
  })
  code.subscribe((next: Code | undefined) => show(next ?? { path: null, text: '', status: '' }))
})

onUnmounted(() => {
  view?.destroy()
  view = null
})
</logic>

<style>
.code-pane {
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
  border-bottom: 1px solid var(--cat-border);
}

.file {
  font: inherit;
  color: inherit;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-0-5) var(--cat-space-1-5);
  max-width: 320px;
}

.dirty {
  color: var(--cat-warning);
  font-size: var(--cat-text-xs);
}

.status {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.status.error {
  color: var(--cat-danger);
}

.bar button {
  font: inherit;
  color: var(--cat-text-on-accent);
  background: var(--cat-accent);
  border: 1px solid var(--cat-accent);
  font-weight: 500;
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-0-5) var(--cat-space-2);
  cursor: pointer;
}

.bar button:disabled {
  opacity: 0.4;
  cursor: default;
}

kbd {
  font: var(--cat-text-xs) var(--cat-font-mono);
  color: var(--cat-text-tertiary);
  margin-left: var(--cat-space-1);
}

.host {
  flex: 1 1 0;
  min-height: 0;
}

.host :global(.cm-editor) {
  height: 100%;
  font-size: var(--cat-text-sm);
}

.host :global(.cm-scroller) {
  font-family: var(--cat-font-mono);
}

.hint {
  position: absolute;
  margin: 40px var(--cat-space-4);
  color: var(--cat-text-tertiary);
  pointer-events: none;
}
</style>
