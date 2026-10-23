<view>
<div class="backdrop" $if="shared['editor:projectDialog'].mode" @pointerdown="cancel()">
  <form class="dialog" @pointerdown="$event.stopPropagation()" @submit="submit($event)">
    <header class="title">{{ state.mode === 'create' ? 'New project' : 'Project settings' }}<button type="button" class="x" @click="cancel()">×</button></header>
    <div class="body">
      <label class="field">Name
        <input class="name" type="text" $model="state.name" placeholder="My project" autofocus @input="state.folderName = folderName()" />
      </label>
      <label class="field" $if="state.mode === 'create' && shared['editor:projectDialog'].locations">Location
        <span class="row">
          <input type="text" $value="state.location || ''" placeholder="choose a folder" readonly />
          <button type="button" @click="pickLocation()">Choose…</button>
        </span>
        <span class="hint" $if="state.location && state.folderName">The project is made at {{ state.location }}/{{ state.folderName }}</span>
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

const state = reactive({ mode: null as Dialog['mode'], name: '', recipe: 'scene', description: '', location: null as string | null, git: false, error: '', folderName: '' })

dialog.subscribe((next: Dialog | undefined) => {
  if (!next) return
  if (next.mode !== state.mode) {
    state.name = next.name
    state.recipe = next.recipe
    state.description = next.description
    state.git = next.git
    state.folderName = folderName()
  }
  state.mode = next.mode
  state.location = next.location
  state.error = next.error
  if (next.mode) setTimeout(() => (document.querySelector('.dialog .name') as HTMLInputElement | null)?.focus(), 0)
})

function folderName(): string {
  const name = state.name.trim()
  return name ? name.toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project' : ''
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
  background: var(--cat-scrim);
}

.dialog {
  width: min(520px, 92vw);
  display: flex;
  flex-direction: column;
  background: var(--cat-bg-panel);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-md);
  box-shadow: var(--cat-shadow-e2);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / var(--cat-leading-body) var(--cat-font-ui);
}

.title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--cat-space-2) var(--cat-space-3);
  border-bottom: 1px solid var(--cat-border);
  font-size: var(--cat-text-md);
  font-weight: 600;
}

.x {
  font: var(--cat-text-lg) / 1 var(--cat-font-ui);
  color: var(--cat-text-secondary);
  background: none;
  border: 0;
  cursor: pointer;
}

.body {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-2);
  padding: var(--cat-space-3);
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

.row input {
  flex: 1 1 auto;
  min-width: 0;
}

input,
select,
textarea {
  font: inherit;
  color: var(--cat-text-primary);
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-1) var(--cat-space-2);
}

textarea {
  resize: vertical;
}

.hint {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.check {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1-5);
  color: var(--cat-text-secondary);
}

.check input {
  margin: 0;
}

.error {
  margin: 0;
  color: var(--cat-danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--cat-space-2);
  padding: var(--cat-space-2) var(--cat-space-3);
  border-top: 1px solid var(--cat-border);
}

button {
  font: inherit;
  color: inherit;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-1) var(--cat-space-3);
  cursor: pointer;
}

button.primary {
  background: var(--cat-accent);
  border-color: var(--cat-accent);
  color: var(--cat-text-on-accent);
  font-weight: 500;
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
