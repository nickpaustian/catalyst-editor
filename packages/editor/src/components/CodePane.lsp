<view>
<div class="code-pane">
  <div class="tabs" role="tablist" aria-label="Open files" $if="state.tabs.length">
    <div $for="tab in state.tabs" $key="tab.path" class="tab" role="tab" tabindex="0" $aria-selected="String(tab.path === state.path)" $title="tab.path" @click="choose(tab.path)" @auxclick="closeOnMiddle($event, tab.path)" @keydown="tabKey($event, tab.path)">
      <span class="tab-name">{{ tab.name }}</span>
      <button class="tab-close" type="button" tabindex="-1" $class="{ unsaved: tab.dirty }" $aria-label="'Close ' + tab.path" $title="tab.dirty ? 'Unsaved: close' : 'Close'" @click="closeTab($event, tab.path)"></button>
    </div>
  </div>
  <div class="bar">
    <span class="well select file"><select aria-label="File" $model="state.choice" @change="choose()">
      <option value="">Open a file…</option>
      <option $for="file in shared['editor:codeFiles']" $key="file" $value="file" $label="file" $selected="file === state.choice">{{ file }}</option>
    </select></span>
    <span class="dirty" $if="state.dirty">unsaved</span>
    <span class="status" $class="{ error: state.error }">{{ state.status }}</span>
    <button class="button small" title="Show it on its own in the preview pane, with its cells and props to set" $if="state.path.endsWith('.lsp')" @click="preview()">Preview</button>
    <button class="button small primary" $disabled="!state.path || !state.dirty" @click="save()">Save</button>
  </div>
  <div class="host" $ref="host"></div>
  <div class="empty-state" $if="!state.path">
    <span class="what">No file open</span>
    <span class="how">Pick a script, component or stylesheet above; each opens in a tab of its own. Components and stylesheets show in the viewport as you type; saving a script rebuilds every script in the scene.</span>
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
import { openConfirm } from '../confirm.ts'
import { storage } from '../preferences.ts'

interface Code { path: string | null; text: string; status: string; draft?: string }
interface FileNews { path: string; text?: string; status: string; to?: string; gone?: boolean }
interface Tab { path: string; name: string; dirty: boolean }
/** A tab's editor, kept while another is shown: its document, undo history and selection, and the text last read or saved. */
interface Kept { state: EditorState; shown: string; status: string }

const code = shared('editor:code', { path: null, text: '', status: '' })
const project = shared('editor:project', null)
const news = shared('editor:codeFile', null)
shared('editor:codeFiles', [])
const saveRequest = shared('editor:saveRequest', 0)
const unsaved = shared('editor:codeUnsaved', [])
const refs = defineRefs<{ host: HTMLElement }>()

// The file chosen in the list, apart from the file shown, so choosing one already open brings its tab forward.
const state = reactive({ path: '', choice: '', tabs: [] as Tab[], dirty: false, status: '', error: false })

let view: EditorView | null = null
const kept = new Map<string, Kept>()
const language = new Compartment()
const PREVIEWED = /\.(lsp|css)$/i
const DRAFT_DELAY = 350
let draftTimer: ReturnType<typeof setTimeout> | null = null

// A component is markup with its logic in TypeScript and its style in CSS.
const languageFor = (path: string) =>
  /\.lsp$/i.test(path) ? html({ nestedLanguages: [{ tag: 'logic', parser: typescriptLanguage.parser }] }) : /\.css$/i.test(path) ? css() : javascript({ typescript: true })

const nameOf = (path: string) => path.replace(/^.*\//, '')

const textOf = (path: string): string => (path === state.path && view ? view.state.doc.toString() : kept.get(path)?.state.doc.toString() ?? '')

const extensionsFor = (path: string) => [
  basicSetup,
  keymap.of([{ key: 'Mod-s', run: saveAll }, indentWithTab]),
  language.of(languageFor(path)),
  oneDark,
  EditorView.updateListener.of((update) => {
    if (update.docChanged) edited()
  }),
]

const blank = () => EditorState.create({ doc: '', extensions: [oneDark, EditorState.readOnly.of(true), EditorView.editable.of(false)] })

// The open tabs and the one in front, kept per project in this browser, so a reload comes back to them.
const TABS_KEY = 'code-tabs'
let tabsOf = ''

function rememberTabs() {
  if (tabsOf) storage.set(`${TABS_KEY}:${tabsOf}`, { paths: state.tabs.map((tab) => tab.path), active: state.path || null })
}

project.subscribe((next: { open: boolean; name: string | null } | null | undefined) => {
  const name = next?.open ? next.name ?? '' : ''
  if (name === tabsOf) return
  tabsOf = name
  const saved = name ? storage.get<{ paths?: string[]; active?: string | null } | null>(`${TABS_KEY}:${name}`, null) : null
  if (saved?.paths?.length) sendCommand({ type: 'openScripts', paths: saved.paths, active: saved.active ?? null })
})

// Every tab whose text differs from what was last read or saved, for the session's saves, questions and autosave.
function publishUnsaved() {
  unsaved.set(state.tabs.filter((tab) => tab.dirty).map((tab) => ({ path: tab.path, text: textOf(tab.path) })))
}

function setDirty(path: string, dirty: boolean) {
  const tab = state.tabs.find((tab) => tab.path === path)
  if (tab && tab.dirty !== dirty) tab.dirty = dirty
  if (path === state.path) state.dirty = dirty
}

function showStatus(status: string) {
  state.status = status
  state.error = Boolean(status) && !/^(saved|reloaded|previewing|restored) /.test(status)
}

function edited() {
  const entry = kept.get(state.path)
  if (!entry || !view) return
  setDirty(state.path, view.state.doc.toString() !== entry.shown)
  publishUnsaved()
  draftSoon()
}

// A component or stylesheet shows in the viewport a moment after typing stops, before it is saved.
function draftSoon() {
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = null
  if (!view || !PREVIEWED.test(state.path) || !state.dirty) return
  const path = state.path
  draftTimer = setTimeout(() => {
    draftTimer = null
    if (view && path === state.path && state.dirty) sendCommand({ type: 'draftFile', path, text: view.state.doc.toString() })
  }, DRAFT_DELAY)
}

function activate(path: string) {
  if (!view) return
  if (path && path === state.path) return
  if (state.path && kept.has(state.path)) kept.get(state.path)!.state = view.state
  const entry = kept.get(path)
  view.setState(entry ? entry.state : blank())
  state.path = entry ? path : ''
  state.choice = state.path
  state.dirty = Boolean(state.tabs.find((tab) => tab.path === state.path)?.dirty)
  showStatus(entry?.status ?? '')
  if (entry) rememberTabs()
}

/** Replace a tab's whole text, shown or kept. */
function replaceText(path: string, text: string) {
  const entry = kept.get(path)
  if (!entry) return
  const change = { changes: { from: 0, to: entry.state.doc.length, insert: text } }
  if (path === state.path && view) view.dispatch(change)
  else entry.state = entry.state.update(change).state
}

function open(next: Code) {
  if (!next.path) return closeAll()
  const path = next.path
  const draft = next.draft !== undefined && next.draft !== next.text ? next.draft : null
  const entry = kept.get(path)
  if (entry) {
    const dirty = Boolean(state.tabs.find((tab) => tab.path === path)?.dirty)
    if (draft !== null) replaceText(path, draft)
    else if (!dirty && textOf(path) !== next.text) replaceText(path, next.text)
    entry.shown = next.text
    if (next.status) entry.status = next.status
  } else {
    kept.set(path, { state: EditorState.create({ doc: draft ?? next.text, extensions: extensionsFor(path) }), shown: next.text, status: next.status })
    state.tabs.push({ path, name: nameOf(path), dirty: false })
  }
  activate(path)
  setDirty(path, textOf(path) !== kept.get(path)!.shown)
  publishUnsaved()
}

function closeAll() {
  kept.clear()
  state.tabs = []
  activate('')
  publishUnsaved()
}

function hear(next: FileNews | null | undefined) {
  if (!next) return
  const entry = kept.get(next.path)
  if (!entry) return
  if (next.gone) return drop(next.path)
  if (next.to) {
    kept.delete(next.path)
    kept.set(next.to, entry)
    const tab = state.tabs.find((tab) => tab.path === next.path)
    if (tab) Object.assign(tab, { path: next.to, name: nameOf(next.to) })
    if (state.path === next.path) state.path = state.choice = next.to
    rememberTabs()
    return publishUnsaved()
  }
  if (next.text !== undefined) {
    const dirty = Boolean(state.tabs.find((tab) => tab.path === next.path)?.dirty)
    if (!dirty && textOf(next.path) !== next.text) replaceText(next.path, next.text)
    entry.shown = next.text
    setDirty(next.path, textOf(next.path) !== entry.shown)
    publishUnsaved()
  }
  entry.status = next.status
  if (next.path === state.path) showStatus(next.status)
}

/** Take a tab away; its unsaved text, if any, goes with it. */
function drop(path: string) {
  const index = state.tabs.findIndex((tab) => tab.path === path)
  if (index < 0) return
  const wasShown = path === state.path
  state.tabs.splice(index, 1)
  kept.delete(path)
  if (wasShown) {
    state.path = ''
    activate(state.tabs[Math.min(index, state.tabs.length - 1)]?.path ?? '')
  }
  rememberTabs()
  publishUnsaved()
}

function closeTab(event: Event | null, path: string) {
  event?.stopPropagation()
  const tab = state.tabs.find((tab) => tab.path === path)
  if (!tab) return
  if (!tab.dirty) {
    drop(path)
    return sendCommand({ type: 'closeScript', path })
  }
  openConfirm(`Save changes to ${path}?`, "Your changes are lost if you don't save them.", [
    { label: 'Cancel', run: () => undefined },
    { label: "Don't save", run: () => { drop(path); sendCommand({ type: 'closeScript', path }) } },
    { label: 'Save', primary: true, run: () => { sendCommand({ type: 'saveScript', path, text: textOf(path) }); drop(path) } },
  ])
}

function closeOnMiddle(event: MouseEvent, path: string) {
  if (event.button !== 1) return
  event.preventDefault()
  closeTab(null, path)
}

function tabKey(event: KeyboardEvent, path: string) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    choose(path)
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    closeTab(null, path)
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    const index = state.tabs.findIndex((tab) => tab.path === path) + (event.key === 'ArrowRight' ? 1 : -1)
    const next = state.tabs[(index + state.tabs.length) % state.tabs.length]
    if (!next) return
    event.preventDefault()
    activate(next.path)
    ;(document.querySelector(`#code-panel .tab[title="${CSS.escape(next.path)}"]`) as HTMLElement | null)?.focus()
  }
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
  if (!n) return
  for (const tab of state.tabs) if (tab.dirty) sendCommand({ type: 'saveScript', path: tab.path, text: textOf(tab.path) })
})

// A tab or a file picked by hand: brought forward with the typing going to it.
function choose(path = state.choice) {
  if (!path) state.choice = state.path
  else if (kept.has(path)) {
    activate(path)
    view?.focus()
  } else sendCommand({ type: 'openScript', path })
}

onMounted(() => {
  view = new EditorView({ parent: refs.host, state: blank() })
  code.subscribe((next: Code | undefined) => open(next ?? { path: null, text: '', status: '' }))
  news.subscribe((next: FileNews | null | undefined) => hear(next))
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

.tabs {
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  background: var(--cat-bg-app);
  border-bottom: 1px solid var(--cat-border-subtle);
}

.tab {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1);
  flex: 0 0 auto;
  height: 28px;
  padding: 0 var(--cat-space-1) 0 var(--cat-space-3);
  margin-bottom: -1px;
  border-right: 1px solid var(--cat-border-subtle);
  color: var(--cat-text-tertiary);
  font-family: var(--cat-font-mono);
  font-size: var(--cat-text-xs);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}

.tab:hover {
  color: var(--cat-text-secondary);
}

.tab[aria-selected="true"] {
  background: var(--cat-bg-panel);
  box-shadow: inset 0 1px 0 var(--cat-accent);
  color: var(--cat-text-primary);
}

.tab:focus-visible {
  outline: 1px solid var(--cat-accent);
  outline-offset: -1px;
}

.tab-close {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--cat-radius-sm);
  background: none;
  color: inherit;
  opacity: 0;
  cursor: pointer;
}

.tab-close::before {
  content: "×";
  font: var(--cat-text-sm) / 1 var(--cat-font-ui);
}

.tab:hover .tab-close,
.tab[aria-selected="true"] .tab-close,
.tab-close.unsaved {
  opacity: 1;
}

.tab-close:hover {
  background: var(--cat-bg-hover);
}

/* Unsaved shows as a dot, which turns back into the close mark under the pointer. */
.tab-close.unsaved:not(:hover)::before {
  content: "";
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--cat-text-secondary);
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
