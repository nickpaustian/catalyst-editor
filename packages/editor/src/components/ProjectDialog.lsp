<view>
<div class="backdrop" $if="shared['editor:projectDialog'].mode" @pointerdown="cancel()">
  <form class="dialog" @pointerdown="$event.stopPropagation()" @submit="submit($event)">
    <header class="title">{{ state.mode === 'create' ? 'New project' : 'Project settings' }}<button type="button" class="x" @click="cancel()">×</button></header>
    <div class="body">
      <label class="field">Name
        <input class="name" type="text" $model="state.name" placeholder="My project" autofocus />
      </label>
      <label class="field" $if="state.mode === 'create' && shared['editor:projectDialog'].locations">Location
        <span class="row">
          <input type="text" $value="state.location || ''" placeholder="choose a folder" readonly />
          <button type="button" @click="pickLocation()">Choose…</button>
        </span>
        <span class="hint" $if="state.location && state.name.trim()">The project is made at {{ state.location }}/{{ folderName() }}</span>
      </label>
      <p class="hint" $else-if="state.mode === 'create'">Kept in this browser's storage; export it to take it elsewhere.</p>
      <label class="field">Recipe
        <select $model="state.recipe" $disabled="state.mode !== 'create'">
          <option $for="recipe in shared['editor:recipes']" $key="recipe" $value="recipe">{{ recipe }}</option>
        </select>
        <span class="hint">What a project is: the node kinds it adds and how its folder becomes a scene.</span>
      </label>
      <label class="field">Description
        <textarea rows="3" $model="state.description" placeholder="A line or two about it"></textarea>
      </label>
      <label class="check" $if="state.mode === 'create' && shared['editor:projectDialog'].canGit">
        <input type="checkbox" $model="state.git" /> Start a git repository <span class="hint">git init, with a .gitignore for node_modules and .DS_Store</span>
      </label>
      <p class="error" $if="state.error">{{ state.error }}</p>
    </div>
    <footer class="actions">
      <button type="button" @click="cancel()">Cancel</button>
      <button type="submit" class="primary" $disabled="!state.name.trim() || (state.mode === 'create' && shared['editor:projectDialog'].locations && !state.location)">{{ state.mode === 'create' ? 'Create' : 'Save' }}</button>
    </footer>
  </form>
</div>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { PROJECT_DIALOG_DEFAULT } from '../cells.ts'

interface Dialog { mode: 'create' | 'edit' | null; name: string; recipe: string; description: string; location: string | null; locations: boolean; git: boolean; canGit: boolean; error: string }

const dialog = shared('editor:projectDialog', PROJECT_DIALOG_DEFAULT)
shared('editor:recipes', ['scene'])

const state = reactive({ mode: null as Dialog['mode'], name: '', recipe: 'scene', description: '', location: null as string | null, git: false, error: '' })

dialog.subscribe((next: Dialog | undefined) => {
  if (!next) return
  if (next.mode !== state.mode) {
    state.name = next.name
    state.recipe = next.recipe
    state.description = next.description
    state.git = next.git
  }
  state.mode = next.mode
  state.location = next.location
  state.error = next.error
  if (next.mode) setTimeout(() => (document.querySelector('.dialog .name') as HTMLInputElement | null)?.focus(), 0)
})

function folderName(): string {
  return state.name.trim().toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}

function pickLocation() {
  sendCommand({ type: 'pickLocation' })
}

function submit(event: Event) {
  event.preventDefault()
  if (state.mode === 'create') sendCommand({ type: 'createProject', name: state.name, recipe: state.recipe, description: state.description, location: state.location, git: state.git })
  else if (state.mode === 'edit') sendCommand({ type: 'saveProjectSettings', name: state.name, description: state.description })
}

function cancel() {
  sendCommand({ type: 'closeProjectDialog' })
}

document.addEventListener('keydown', (event) => {
  if (state.mode && event.key === 'Escape') cancel()
})
</logic>

<style>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.dialog {
  width: min(520px, 92vw);
  display: flex;
  flex-direction: column;
  background: #161616;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  color: #ddd;
  font: 12px/1.4 "IBM Plex Sans", system-ui, sans-serif;
}

.title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #2a2a2a;
  font-size: 13px;
  font-weight: 600;
}

.x {
  font: 16px/1 system-ui, sans-serif;
  color: #999;
  background: none;
  border: 0;
  cursor: pointer;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
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

.row input {
  flex: 1 1 auto;
  min-width: 0;
}

input,
select,
textarea {
  font: inherit;
  color: #eee;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 5px 8px;
}

textarea {
  resize: vertical;
}

.hint {
  color: #777;
  font-size: 11px;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #bbb;
}

.check input {
  margin: 0;
}

.error {
  margin: 0;
  color: #e07070;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #2a2a2a;
}

button {
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 5px 14px;
  cursor: pointer;
}

button.primary {
  background: #3b5aa0;
  border-color: #6a8fd8;
  color: #fff;
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
