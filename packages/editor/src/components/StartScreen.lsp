<view>
<div class="start" $class="{ window: shared['editor:startMode'] === 'window' }" $if="shared['editor:startMode'] === 'window' || (shared['editor:startMode'] !== 'off' && !shared['editor:project'].open)">
  <div class="card" data-tauri-drag-region>
    <div class="drag" data-tauri-drag-region $if="shared['editor:startMode'] === 'window'"></div>
    <header data-tauri-drag-region>
      <h1>Catalyst</h1>
      <p class="tagline">Open a project to begin.</p>
    </header>
    <div class="columns">
      <section class="actions">
        <button class="primary big" @click="newProject()">New project… <span class="dim">{{ shared['editor:project'].browserStorage ? 'kept in this browser' : 'a folder named after it' }}</span></button>
        <button class="big" $disabled="!shared['editor:project'].supported" @click="run('openFolder')">Open folder…</button>
        <p class="hint" $if="!shared['editor:project'].supported && !shared['editor:project'].browserStorage">This browser can neither open folders nor keep projects of its own.</p>
      </section>
      <section class="recent">
        <h2>Recent</h2>
        <p class="hint" $if="!shared['editor:recent'] || shared['editor:recent'].length === 0">Nothing yet.</p>
        <div class="project" $for="project in shared['editor:recent']" $key="project.id" @click="openRecent(project)">
          <span class="name">{{ project.name }}</span>
          <span class="location">{{ project.location }}</span>
          <button class="forget" title="Remove from this list" @click="forget($event, project)">×</button>
        </div>
      </section>
    </div>
    <p class="status" $if="shared['editor:project'].status">{{ shared['editor:project'].status }}</p>
  </div>
</div>
</view>

<logic lang="ts">
import { shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { PROJECT_DEFAULT } from '../cells.ts'

interface Project { id: string; name: string; location: string }

shared('editor:project', PROJECT_DEFAULT)
shared('editor:recent')
shared('editor:startMode', 'overlay')

function run(type: string) {
  sendCommand({ type })
}

function newProject() {
  sendCommand({ type: 'openProjectDialog', mode: 'create' })
}

function openRecent(project: Project) {
  sendCommand({ type: 'openRecent', id: project.id })
}

function forget(event: Event, project: Project) {
  event.stopPropagation()
  sendCommand({ type: 'forgetRecent', id: project.id })
}
</logic>

<style>
.start {
  position: fixed;
  inset: var(--menu-bar-height) 0 0 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--cat-bg-app);
  color: var(--cat-text-primary);
  font: var(--cat-text-md) / var(--cat-leading-body) var(--cat-font-ui);
}

.start.window {
  inset: 0;
  background: var(--cat-bg-panel);
}

.start.window .card {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: none;
  border-radius: 0;
  box-shadow: none;
}

.start.window .card {
  position: relative;
}

.drag {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 28px;
}

:global(html.shell-macos) .start.window .card {
  padding-top: 52px;
}

.card {
  width: min(760px, 92vw);
  padding: var(--cat-space-6) var(--cat-space-8);
  background: var(--cat-bg-panel);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-lg);
  box-shadow: var(--cat-shadow-e2);
}

header {
  margin-bottom: var(--cat-space-4);
}

h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.tagline {
  margin: var(--cat-space-0-5) 0 0;
  color: var(--cat-text-secondary);
}

.columns {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: var(--cat-space-6);
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-2);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-1);
  color: var(--cat-text-secondary);
}

.row {
  display: flex;
  gap: var(--cat-space-1);
}

input {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  color: inherit;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-1) var(--cat-space-2);
}

button {
  font: inherit;
  color: inherit;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-1-5) var(--cat-space-3);
  cursor: pointer;
  text-align: left;
}

button:hover {
  background: var(--cat-bg-hover);
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

button.primary {
  background: var(--cat-accent);
  border-color: var(--cat-accent);
  color: var(--cat-text-on-accent);
  font-weight: 500;
}

button.big {
  padding: var(--cat-space-2) var(--cat-space-3);
}

.dim {
  color: var(--cat-text-secondary);
  font-size: var(--cat-text-xs);
  margin-left: var(--cat-space-1);
}

button.primary .dim {
  color: inherit;
}

h2 {
  margin: 0 0 var(--cat-space-2);
  font-size: var(--cat-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cat-text-secondary);
}

.recent {
  min-height: 160px;
}

.project {
  display: flex;
  align-items: baseline;
  gap: var(--cat-space-2);
  padding: var(--cat-space-1-5) var(--cat-space-2);
  border-radius: var(--cat-radius-sm);
  cursor: pointer;
}

.project:hover {
  background: var(--cat-bg-hover);
}

.name {
  font-weight: 600;
}

.location {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
  direction: rtl;
  text-align: left;
}

.forget {
  padding: 0 var(--cat-space-1-5);
  border: none;
  background: none;
  color: var(--cat-text-tertiary);
  line-height: 1;
}

.forget:hover {
  color: var(--cat-text-primary);
}

.hint {
  color: var(--cat-text-tertiary);
  margin: var(--cat-space-1) 0;
}

.status {
  margin: var(--cat-space-4) 0 0;
  color: var(--cat-text-secondary);
  font-size: var(--cat-text-xs);
}
</style>
