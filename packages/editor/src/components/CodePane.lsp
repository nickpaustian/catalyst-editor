<view>
<div class="code-pane">
  <div class="bar">
    <span class="well select file"><select aria-label="File" $model="state.path" @change="choose()">
      <option value="">Choose a file…</option>
      <option $for="file in shared['editor:codeFiles']" $key="file" $value="file" $label="file">{{ file }}</option>
    </select></span>
    <span class="dirty" $if="state.dirty">unsaved</span>
    <span class="status" $class="{ error: state.error }">{{ state.status }}</span>
    <button class="button small" title="Show it on its own in the preview pane, with its cells and props to set" $if="state.path.endsWith('.lsp')" @click="preview()">Preview</button>
    <button class="button small primary" $disabled="!state.path || !state.dirty" @click="save()">Save</button>
  </div>
  <div class="host" $ref="host"></div>
  <div class="empty-state" $if="!state.path">
    <span class="what">No file open</span>
    <span class="how">Pick a script, component or stylesheet above. Components and stylesheets show in the viewport as you type; saving a script rebuilds every script in the scene.</span>
  </div>
</div>
</view>

<logic lang="ts">
import { reactive, shared, defineRefs, onMounted, onUnmounted } from '@lightspeed-js/core'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { javascript, typescriptLanguage } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { oneDark } from '@codemirror/theme-one-dark'
import { sendCommand } from '../commands.ts'

interface Code { path: string | null; text: string; status: string }

const code = shared('editor:code', { path: null, text: '', status: '' })
shared('editor:codeFiles', [])
const saveRequest = shared('editor:saveRequest', 0)
const refs = defineRefs<{ host: HTMLElement }>()

const state = reactive({ path: '', dirty: false, status: '', error: false })

let view: EditorView | null = null
let shown = ''
const readOnly = new Compartment()
const language = new Compartment()
const PREVIEWED = /\.(lsp|css)$/i
const DRAFT_DELAY = 350
let draftTimer: ReturnType<typeof setTimeout> | null = null

// A component is markup with its logic in TypeScript and its style in CSS.
const languageFor = (path: string) =>
  /\.lsp$/i.test(path) ? html({ nestedLanguages: [{ tag: 'logic', parser: typescriptLanguage.parser }] }) : /\.css$/i.test(path) ? css() : javascript({ typescript: true })

// A component or stylesheet shows in the viewport a moment after typing stops, before it is saved.
function draftSoon() {
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = null
  if (!view || !PREVIEWED.test(state.path) || !state.dirty) return
  draftTimer = setTimeout(() => {
    draftTimer = null
    if (view && state.dirty) sendCommand({ type: 'draftFile', path: state.path, text: view.state.doc.toString() })
  }, DRAFT_DELAY)
}

function save(): boolean {
  if (!view || !state.path) return false
  sendCommand({ type: 'saveScript', path: state.path, text: view.state.doc.toString() })
  return true
}

function preview() {
  if (state.path) sendCommand({ type: 'preview', path: state.path })
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
  if (path !== state.path) view.dispatch({ effects: language.reconfigure(languageFor(path)) })
  state.path = path
  state.status = next.status
  state.error = Boolean(next.status) && !/^(saved|reloaded|previewing) /.test(next.status)
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
        language.of(javascript({ typescript: true })),
        oneDark,
        readOnly.of(EditorState.readOnly.of(true)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          state.dirty = update.state.doc.toString() !== shown
          draftSoon()
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
  position: relative;
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

.file {
  flex: 0 1 320px;
}

.dirty {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1-5);
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.dirty::before {
  content: "";
  width: var(--cat-space-1-5);
  height: var(--cat-space-1-5);
  border-radius: 50%;
  background: var(--cat-text-secondary);
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

.empty-state {
  position: absolute;
  inset: var(--cat-panel-header) 0 0 0;
  pointer-events: none;
}
</style>
