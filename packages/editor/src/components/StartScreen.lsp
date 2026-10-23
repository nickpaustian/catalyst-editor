<view>
<div class="start" $if="!shared['editor:project'].open">
  <div class="card">
    <header>
      <h1>Catalyst</h1>
      <p class="tagline">Open a project to begin.</p>
    </header>
    <div class="columns">
      <section class="actions">
        <template $if="shared['editor:project'].browserStorage">
          <label class="field">New project in the browser
            <span class="row"><input type="text" $model="state.name" placeholder="name" @keydown="nameKey($event)" /><button class="primary" @click="create()">Create</button></span>
          </label>
        </template>
        <button class="primary big" $else @click="run('newProject')">New project… <span class="dim">pick or make a folder</span></button>
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
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

interface Project { id: string; name: string; location: string }

shared('editor:project', { open: false, name: null, recipe: '', storage: null, status: '', supported: false, browserStorage: false, dirty: false })
shared('editor:recent')

const state = reactive({ name: 'untitled' })

function run(type: string) {
  sendCommand({ type })
}

function create() {
  sendCommand({ type: 'newProject', name: state.name.trim() || 'untitled' })
}

function nameKey(event: KeyboardEvent) {
  if (event.key === 'Enter') create()
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
  inset: var(--menu-bar-height, 30px) 0 0 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 10, 0.92);
  color: #eee;
  font: 13px/1.5 "IBM Plex Sans", system-ui, sans-serif;
}

.card {
  width: min(760px, 92vw);
  padding: 28px 32px;
  background: #161616;
  border: 1px solid #333;
  border-radius: 8px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
}

header {
  margin-bottom: 20px;
}

h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.tagline {
  margin: 2px 0 0;
  color: #999;
}

.columns {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 28px;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: #bbb;
}

.row {
  display: flex;
  gap: 4px;
}

input {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 5px 8px;
}

button {
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  text-align: left;
}

button:hover {
  background: #2a2a2a;
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

button.primary {
  background: #3b5aa0;
  border-color: #6a8fd8;
  color: #fff;
}

button.big {
  padding: 10px 14px;
}

.dim {
  color: #aab;
  font-size: 11px;
  margin-left: 4px;
}

h2 {
  margin: 0 0 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #999;
}

.recent {
  min-height: 160px;
}

.project {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.project:hover {
  background: #202020;
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
  color: #888;
  font-size: 11px;
  direction: rtl;
  text-align: left;
}

.forget {
  padding: 0 6px;
  border: none;
  background: none;
  color: #777;
  line-height: 1;
}

.forget:hover {
  color: #ddd;
}

.hint {
  color: #777;
  margin: 4px 0;
}

.status {
  margin: 16px 0 0;
  color: #999;
  font-size: 11px;
}
</style>
