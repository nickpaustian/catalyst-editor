<view>
<div class="scrim" $if="shared['editor:projectDialog'].mode" @pointerdown="cancel()">
  <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" @pointerdown="$event.stopPropagation()" @submit="submit($event)">
    <h2 class="dialog-title" id="project-dialog-title">{{ state.mode === 'create' ? 'New project' : 'Project settings' }}</h2>
    <label class="dialog-field">Name
      <input class="well large name" type="text" $model="state.name" placeholder="My project" autofocus @input="state.folderName = folderName()" />
    </label>
    <div class="dialog-field" $if="state.mode === 'create' && shared['editor:projectDialog'].locations">
      <span>Location</span>
      <span class="location">
        <input class="well large mono" type="text" aria-label="Location" $value="state.location || ''" placeholder="Choose a folder" readonly />
        <button class="button large" type="button" @click="pickLocation()">Choose…</button>
      </span>
      <span class="hint" $if="state.location && state.folderName">Creates <span class="mono">{{ state.location }}/{{ state.folderName }}/</span></span>
    </div>
    <p class="hint" $else-if="state.mode === 'create'">Kept in this browser's storage; export it to take it elsewhere.</p>
    <label class="dialog-field" title="What a project is: the node kinds it adds and how its folder becomes a scene.">Recipe
      <span class="well large select">
        <select $model="state.recipe" $disabled="state.mode !== 'create'">
          <option $for="recipe in shared['editor:recipes']" $key="recipe" $value="recipe">{{ recipe }}</option>
        </select>
      </span>
    </label>
    <label class="dialog-field">Description
      <textarea class="well" rows="3" $model="state.description" placeholder="A line or two about it"></textarea>
    </label>
    <label class="check" title="git init, with a .gitignore for node_modules and .DS_Store" $if="state.mode === 'create' && shared['editor:projectDialog'].canGit">
      <input class="checkbox" type="checkbox" $model="state.git" /> Start a git repository
    </label>
    <p class="error" $if="state.error">{{ state.error }}</p>
    <footer class="dialog-actions">
      <span class="dialog-keys">↵ {{ state.mode === 'create' ? 'create' : 'save' }} · Esc cancel</span>
      <button class="button large" type="button" @click="cancel()">Cancel</button>
      <button class="button large primary" type="submit" $disabled="!state.name.trim() || (state.mode === 'create' && shared['editor:projectDialog'].locations && !state.location)">{{ state.mode === 'create' ? 'Create project' : 'Save' }}</button>
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
.scrim {
  z-index: 1300;
}

.name {
  font-size: var(--cat-text-md);
}

.location {
  display: flex;
  gap: var(--cat-space-1-5);
}

.location .well {
  flex: 1 1 auto;
}

.hint {
  margin: 0;
  color: var(--cat-text-tertiary);
}

.hint .mono {
  color: var(--cat-text-secondary);
}

.check {
  display: flex;
  align-items: center;
  gap: var(--cat-space-2);
  color: var(--cat-text-secondary);
}

.error {
  margin: 0;
  color: var(--cat-danger);
}
</style>
