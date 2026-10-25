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
    <div class="dialog-field">
      <span>Image</span>
      <span class="image-field">
        <span class="cover" $class="{ empty: !state.image }">
          <img $if="state.image" $src="state.image" alt="" />
          <svg $else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="m2.5 11 3.5-3.5 2.5 2.5 2-2 3 3"/><circle cx="10.5" cy="6" r="1"/></svg>
        </span>
        <span class="image-actions">
          <button class="button" type="button" @click="pickImage()">{{ state.image ? 'Replace…' : 'Choose…' }}</button>
          <button class="button ghost" type="button" $if="state.image" @click="removeImage()">Remove</button>
          <span class="hint">Shown in the recent list.</span>
        </span>
      </span>
    </div>
    <label class="check" title="git init, with a .gitignore for node_modules, .DS_Store and built .theca packages" $if="state.mode === 'create' && shared['editor:projectDialog'].canGit">
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

interface Dialog { mode: 'create' | 'edit' | null; name: string; recipe: string; description: string; image: string | null; location: string | null; locations: boolean; git: boolean; canGit: boolean; error: string; taken: string }

const dialog = shared('editor:projectDialog', PROJECT_DIALOG_DEFAULT)
shared('editor:recipes', ['scene'])

const state = reactive({ mode: null as Dialog['mode'], name: '', recipe: 'scene', description: '', image: null as string | null, imageChanged: false, location: null as string | null, git: false, error: '', taken: '', problem: '', preview: '', valid: false })

/** The picture is kept small: the longest side at most this many pixels. */
const IMAGE_SIZE = 640

const NOT_IN_NAMES = /[/\\:*?"<>|]/

dialog.subscribe((next: Dialog | undefined) => {
  if (!next) return
  const opening = next.mode !== state.mode
  const moved = next.location !== state.location
  if (opening) {
    state.name = next.name
    state.recipe = next.recipe
    state.description = next.description
    state.image = next.image ?? null
    state.imageChanged = false
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

// The chosen picture is scaled down and kept as a data url until Save writes it
function pickImage() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.style.display = 'none'
  document.body.appendChild(input)
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    input.remove()
    if (!file) return
    try {
      state.image = await shrink(file)
      state.imageChanged = true
    } catch (error) {
      state.error = `That image could not be read: ${error instanceof Error ? error.message : error}`
    }
  })
  input.click()
}

function removeImage() {
  state.image = null
  state.imageChanged = true
}

async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, IMAGE_SIZE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/png')
}

function submit(event: Event) {
  event.preventDefault()
  if (!state.valid) return
  if (state.mode === 'create') sendCommand({ type: 'createProject', name: state.name.trim(), recipe: state.recipe, description: state.description, location: state.location, git: state.git, image: state.image })
  else if (state.mode === 'edit') sendCommand({ type: 'saveProjectSettings', name: state.name.trim(), description: state.description, image: state.imageChanged ? state.image : undefined })
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

.image-field {
  display: flex;
  align-items: center;
  gap: var(--cat-space-3);
}

.cover {
  flex: 0 0 auto;
  width: 112px;
  height: 70px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-md);
  color: var(--cat-text-tertiary);
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover svg {
  width: 20px;
  height: 20px;
}

.image-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--cat-space-2);
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
