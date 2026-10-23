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
  background: #101010;
  color: #eee;
  font: 12px/1.4 "IBM Plex Sans", system-ui, sans-serif;
}

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: 1px solid #2a2a2a;
}

.file {
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 6px;
  max-width: 320px;
}

.dirty {
  color: #e0b050;
  font-size: 11px;
}

.status {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #888;
  font-size: 11px;
}

.status.error {
  color: #e07070;
}

.bar button {
  font: inherit;
  color: #fff;
  background: #3b5aa0;
  border: 1px solid #6a8fd8;
  border-radius: 3px;
  padding: 2px 10px;
  cursor: pointer;
}

.bar button:disabled {
  opacity: 0.4;
  cursor: default;
}

kbd {
  font: 10px ui-monospace, Menlo, monospace;
  color: #cdd;
  margin-left: 4px;
}

.host {
  flex: 1 1 0;
  min-height: 0;
}

.host :global(.cm-editor) {
  height: 100%;
  font-size: 12px;
}

.host :global(.cm-scroller) {
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.hint {
  position: absolute;
  margin: 40px 16px;
  color: #777;
  pointer-events: none;
}
</style>
