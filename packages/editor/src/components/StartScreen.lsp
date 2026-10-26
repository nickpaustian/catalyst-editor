<view>
<div class="start" $class="{ window: shared['editor:startMode'] === 'window' }" $if="shared['editor:startMode'] === 'window' || (shared['editor:startMode'] !== 'off' && !shared['editor:project'].open)">
  <div class="drag" data-tauri-drag-region $if="shared['editor:startMode'] === 'window'"></div>
  <aside class="intro" data-tauri-drag-region>
    <div class="welcome">
      <span class="logo" $html="state.logo"></span>
      <p class="tagline">Create a project or open one to begin.</p>
    </div>
    <div class="actions">
      <button class="button primary action" type="button" @click="newProject()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>
        <span class="label">New project…</span>
        <span class="shortcut">⌘N</span>
      </button>
      <button class="button action" type="button" $disabled="!shared['editor:project'].supported" @click="run('openFolder')">
        <svg class="folder" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13z"/></svg>
        <span class="label">Open folder…</span>
        <span class="shortcut">⌘O</span>
      </button>
    </div>
    <p class="note" $if="shared['editor:project'].browserStorage">New projects are kept in this browser's storage. Open folder works with any Catalyst folder on disk where the browser allows it.</p>
    <p class="note" $else-if="shared['editor:project'].supported">A project is a folder. New project creates one named after the project; Open folder works with any existing Catalyst folder.</p>
    <p class="note" $else>This browser can neither open folders nor keep projects of its own.</p>
  </aside>
  <main class="recent">
    <template $if="state.all.length">
      <div class="recent-header">
        <h2 class="section-label">Recent</h2>
        <label class="well filter">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 4 4"/></svg>
          <input type="search" placeholder="Filter" aria-label="Filter recent projects" $model="state.filter" @input="refresh()" />
        </label>
      </div>
      <ul class="projects" @keydown="moveCursor($event)">
        <li class="project" $for="project in state.rows" $key="project.id" $class="{ missing: project.missing }">
          <template $if="project.missing">
            <span class="tile">
              <svg class="warning" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2 14.5 13.5h-13z"/><path d="M8 6.5v3M8 11.5v.01"/></svg>
            </span>
            <span class="text">
              <span class="name">{{ project.name }}</span>
              <span class="problem" title="Folder not found — it may have been moved or deleted">Folder not found — it may have been moved or deleted</span>
            </span>
            <button class="button small" type="button" @click="locate(project)">Locate…</button>
            <button class="button small ghost" type="button" @click="forget($event, project)">Remove</button>
          </template>
          <template $else>
            <button class="open" type="button" @click="openRecent(project)">
              <span class="tile" $class="{ pictured: Boolean(project.image) }">
                <img $if="project.image" $src="project.image" alt="" draggable="false" />
                <svg $else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5 14 4.75v6.5L8 14.5 2 11.25v-6.5z"/><path d="M2 4.75 8 8l6-3.25M8 8v6.5"/></svg>
              </span>
              <span class="text">
                <span class="name">{{ project.name }}</span>
                <span class="path"><bdi>{{ project.location }}</bdi></span>
              </span>
              <span class="when">{{ project.when }}</span>
            </button>
            <button class="icon-button forget" type="button" title="Remove from Recent" aria-label="Remove from Recent" @click="forget($event, project)">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>
            </button>
          </template>
        </li>
      </ul>
      <p class="no-match" $if="!state.rows.length">No recent project matches “{{ state.filter }}”.</p>
    </template>
    <div class="empty-state" $else>
      <span class="what">No recent projects</span>
      <span class="how">Projects you create or open will appear here.</span>
    </div>
    <p class="status" $if="shared['editor:project'].status">{{ shared['editor:project'].status }}</p>
  </main>
</div>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { PROJECT_DEFAULT, PROJECT_DIALOG_DEFAULT } from '../cells.ts'
import { LOGO_ON_DARK } from '../assets/logo.ts'

interface Project { id: string; name: string; location: string; missing?: boolean; opened?: number; image?: string | null }
interface Row extends Project { when: string }

const project = shared('editor:project', PROJECT_DEFAULT)
const recent = shared('editor:recent')
const startMode = shared('editor:startMode', 'overlay')
const projectDialog = shared('editor:projectDialog', PROJECT_DIALOG_DEFAULT)

const state = reactive({ logo: LOGO_ON_DARK, filter: '', all: [] as Project[], rows: [] as Row[] })

const DAY = 24 * 60 * 60 * 1000

function when(opened: number | undefined): string {
  if (!opened) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.ceil((today.getTime() - opened) / DAY)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  const thisYear = new Date(opened).getFullYear() === today.getFullYear()
  return new Date(opened).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: thisYear ? undefined : 'numeric' })
}

function refresh() {
  const needle = state.filter.trim().toLowerCase()
  state.rows = state.all
    .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.location.toLowerCase().includes(needle))
    .map((p) => ({ ...p, when: when(p.opened) }))
}

recent.subscribe((next: Project[] | undefined) => {
  state.all = next ?? []
  refresh()
})

function run(type: string) {
  sendCommand({ type })
}

function newProject() {
  sendCommand({ type: 'openProjectDialog', mode: 'create' })
}

function openRecent(project: Project) {
  sendCommand({ type: 'openRecent', id: project.id })
}

function locate(project: Project) {
  sendCommand({ type: 'locateRecent', id: project.id })
}

function forget(event: Event, project: Project) {
  event.stopPropagation()
  sendCommand({ type: 'forgetRecent', id: project.id })
}

// Up and down move between the projects that can be opened; Enter opens the focused one
function moveCursor(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const rows = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('.open'))
  const at = rows.indexOf(document.activeElement as HTMLButtonElement)
  const next = at < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))
  rows[next]?.focus()
}

const shown = () => startMode.value === 'window' || (startMode.value !== 'off' && !project.value?.open)

document.addEventListener('keydown', (event) => {
  if (!shown() || projectDialog.value?.mode || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
  const key = event.key.toLowerCase()
  if (key === 'n') {
    event.preventDefault()
    newProject()
  } else if (key === 'o' && project.value?.supported) {
    event.preventDefault()
    run('openFolder')
  }
})
</logic>

<style>
.start {
  position: fixed;
  inset: var(--menu-bar-height) 0 0 0;
  z-index: 1100;
  display: flex;
  flex-wrap: wrap;
  overflow: auto;
  background: var(--cat-bg-app);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / var(--cat-leading-body) var(--cat-font-ui);
}

.start.window {
  inset: 0;
}

.drag {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: var(--cat-h-md);
}

.intro {
  flex: 1 1 280px;
  max-width: 340px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-8);
  padding: 56px var(--cat-space-8) var(--cat-space-8);
  background: var(--cat-bg-panel);
  border-right: 1px solid var(--cat-border-subtle);
}

.welcome {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-3);
}

.logo {
  display: flex;
  align-self: flex-start;
  height: 36px;
}

.logo :global(svg) {
  width: auto;
  height: 100%;
}

.tagline {
  margin: 0;
  color: var(--cat-text-secondary);
  font-size: var(--cat-text-md);
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-2);
}

.action {
  justify-content: flex-start;
  gap: var(--cat-space-2);
  height: 36px;
  font-size: var(--cat-text-md);
}

.action svg {
  flex: 0 0 var(--cat-icon);
  width: var(--cat-icon);
  height: var(--cat-icon);
}

.action .folder {
  color: var(--cat-text-secondary);
}

.action .label {
  flex: 1 1 auto;
  text-align: left;
}

.shortcut {
  color: var(--cat-text-tertiary);
  font: var(--cat-text-xs) / 1 var(--cat-font-mono);
}

.action.primary .shortcut {
  color: inherit;
  opacity: 0.7;
}

.note {
  margin: auto 0 0;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
  text-wrap: pretty;
}

.recent {
  flex: 999 1 400px;
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-3);
  padding: 56px 40px var(--cat-space-8);
}

.recent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--cat-space-4);
}

.recent-header .section-label {
  color: var(--cat-text-tertiary);
}

.filter {
  width: 220px;
  height: var(--cat-menu-item);
  gap: var(--cat-space-1-5);
  color: var(--cat-text-tertiary);
}

.filter svg {
  flex: 0 0 var(--cat-icon-xs);
  width: var(--cat-icon-xs);
  height: var(--cat-icon-xs);
}

.filter input {
  color: var(--cat-text-primary);
}

.projects {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-0-5);
  margin: 0;
  padding: 0;
  list-style: none;
}

.project {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--cat-space-3);
  height: 56px;
  border-radius: var(--cat-radius-md);
}

.project.missing {
  padding: 0 var(--cat-space-2) 0 10px;
}

.open {
  display: flex;
  align-items: center;
  gap: var(--cat-space-3);
  width: 100%;
  height: 100%;
  padding: 0 40px 0 10px;
  background: transparent;
  border: 0;
  border-radius: var(--cat-radius-md);
  color: var(--cat-text-primary);
  text-align: left;
  cursor: pointer;
  outline: none;
}

.open:hover,
.open:focus-visible {
  background: var(--cat-bg-hover);
}

.tile {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-md);
  color: var(--cat-text-secondary);
}

.tile svg {
  width: var(--cat-icon);
  height: var(--cat-icon);
}

.tile.pictured {
  flex-basis: 58px;
  width: 58px;
  overflow: hidden;
  padding: 0;
}

.tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.missing .tile {
  background: transparent;
  border: 1px dashed var(--cat-border-strong);
}

.tile .warning {
  color: var(--cat-danger);
}

.text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.name {
  overflow: hidden;
  font-size: var(--cat-text-md);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.missing .name {
  color: var(--cat-text-secondary);
}

/* rtl truncates from the start, so the project's own folder stays in view; the bdi keeps the path reading left to right */
.path {
  overflow: hidden;
  color: var(--cat-text-tertiary);
  font: var(--cat-text-xs) / var(--cat-leading-tight) var(--cat-font-mono);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
}

.problem {
  overflow: hidden;
  color: var(--cat-danger);
  font-size: var(--cat-text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.when {
  flex: 0 0 auto;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.forget {
  position: absolute;
  right: var(--cat-space-2);
  opacity: 0;
}

.project:hover .forget,
.forget:focus-visible {
  opacity: 1;
}

.no-match,
.status {
  margin: 0;
  color: var(--cat-text-tertiary);
}

.empty-state {
  flex: 1 1 auto;
  padding-bottom: 40px;
}

.empty-state .what {
  font-size: var(--cat-text-md);
}
</style>
