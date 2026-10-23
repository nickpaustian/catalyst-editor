<view>
<div class="scrim" $if="shared['editor:projectDialog'].mode" @pointerdown="cancel()">
  <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" @pointerdown="$event.stopPropagation()" @submit="submit($event)">
    <h2 class="dialog-title" id="project-dialog-title">{{ state.mode === 'create' ? 'New project' : 'Project settings' }}</h2>
    <label class="dialog-field">Name
      <input class="well large name" type="text" spellcheck="false" $model="state.name" $aria-invalid="Boolean(state.problem)" aria-describedby="project-dialog-hint" @input="edited()" />
    </label>
    <div class="dialog-field" $if="state.mode === 'create' && shared['editor:projectDialog'].locations">
      <span>Location</span>
      <span class="location">
        <span class="well large path-well">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 3.5h4.5l1.5 1.5h7v8h-13z"/></svg>
          <span class="path" $if="state.location"><bdi>{{ state.location }}</bdi></span>
          <span class="placeholder" $else>Choose a folder</span>
        </span>
        <button class="button large" type="button" @click="pickLocation()">Change…</button>
      </span>
    </div>
    <p class="hint" id="project-dialog-hint" $if="state.mode === 'create' || state.problem">
      <template $if="state.problem">
        <svg class="warning" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2 14.5 13.5h-13z"/><path d="M8 6.5v3M8 11.5v.01"/></svg>
        <span class="problem">{{ state.problem }}</span>
      </template>
      <template $else-if="shared['editor:projectDialog'].locations">
        <span>Creates</span><span class="mono preview">{{ state.preview }}</span>
      </template>
      <span $else>Kept in this browser's storage; export it to take it elsewhere.</span>
    </p>
    <label class="dialog-field" title="What a project is: the node kinds it adds and how its folder becomes a scene." $if="shared['editor:recipes'].length > 1">Recipe
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
      <button class="button large primary" type="submit" $disabled="!state.valid">{{ state.mode === 'create' ? 'Create project' : 'Save' }}</button>
    </footer>
  </form>
</div>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { PROJECT_DIALOG_DEFAULT } from '../cells.ts'

interface Dialog { mode: 'create' | 'edit' | null; name: string; recipe: string; description: string; location: string | null; locations: boolean; git: boolean; canGit: boolean; error: string; taken: string }

const dialog = shared('editor:projectDialog', PROJECT_DIALOG_DEFAULT)
shared('editor:recipes', ['scene'])

const state = reactive({ mode: null as Dialog['mode'], name: '', recipe: 'scene', description: '', location: null as string | null, git: false, error: '', taken: '', problem: '', preview: '', valid: false })

const NOT_IN_NAMES = /[/\\:*?"<>|]/

dialog.subscribe((next: Dialog | undefined) => {
  if (!next) return
  const opening = next.mode !== state.mode
  const moved = next.location !== state.location
  if (opening) {
    state.name = next.name
    state.recipe = next.recipe
    state.description = next.description
    state.git = next.git
  }
  state.mode = next.mode
  state.location = next.location
  state.error = next.error
  state.taken = next.taken ?? ''
  update()
  if (opening || moved) check(0)
  if (opening && next.mode) setTimeout(() => {
    const input = document.querySelector<HTMLInputElement>('.dialog .name')
    input?.focus()
    input?.select()
  }, 0)
})

// The folder a name becomes on disk, as the project's folder source makes it
function folderName(name: string): string {
  return name.toLowerCase().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}

let checking: ReturnType<typeof setTimeout> | undefined

// Whether the name's folder already exists is asked for, and the answer
// comes back through the cell as `taken`
function check(delay: number) {
  clearTimeout(checking)
  const name = state.name.trim()
  if (state.mode !== 'create' || !name || NOT_IN_NAMES.test(name)) return
  checking = setTimeout(() => sendCommand({ type: 'checkProjectName', name, location: state.location }), delay)
}

function edited() {
  update()
  check(120)
}

// What's wrong with the name, if anything, and where the project would go
function update() {
  const name = state.name.trim()
  const creating = state.mode === 'create'
  const locations = Boolean(dialog.value?.locations)
  if (!name) state.problem = 'Give the project a name.'
  else if (creating && NOT_IN_NAMES.test(name)) state.problem = 'Names can’t contain / \\ : * ? " < > |'
  else if (creating && state.taken && state.taken === name) state.problem = `A folder named “${locations ? folderName(name) : name}” already exists here.`
  else state.problem = ''
  const parent = state.location?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  state.preview = name ? `…/${parent}/${folderName(name)}/` : ''
  state.valid = !state.problem && (!creating || !locations || Boolean(state.location))
}

function pickLocation() {
  sendCommand({ type: 'pickLocation' })
}

function submit(event: Event) {
  event.preventDefault()
  if (!state.valid) return
  if (state.mode === 'create') sendCommand({ type: 'createProject', name: state.name.trim(), recipe: state.recipe, description: state.description, location: state.location, git: state.git })
  else if (state.mode === 'edit') sendCommand({ type: 'saveProjectSettings', name: state.name.trim(), description: state.description })
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

.path-well {
  flex: 1 1 auto;
  gap: var(--cat-space-2);
  color: var(--cat-text-primary);
}

.path-well svg {
  flex: 0 0 var(--cat-icon-sm);
  width: var(--cat-icon-sm);
  height: var(--cat-icon-sm);
  color: var(--cat-text-secondary);
}

.path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  font-family: var(--cat-font-mono);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
}

.placeholder {
  color: var(--cat-text-tertiary);
}

.hint {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1-5);
  min-height: var(--cat-leading-body);
  margin: 0;
  color: var(--cat-text-tertiary);
}

.preview {
  overflow: hidden;
  color: var(--cat-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.warning {
  flex: 0 0 var(--cat-icon-sm);
  width: var(--cat-icon-sm);
  height: var(--cat-icon-sm);
  color: var(--cat-danger);
}

.problem {
  color: var(--cat-danger);
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
