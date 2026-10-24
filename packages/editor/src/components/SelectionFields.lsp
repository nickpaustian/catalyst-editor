<view>
<div class="selection" @dragover="scriptOver($event)" @dragleave="scriptLeave($event)" @drop="scriptDrop($event)">
  <div class="empty-state" $if="!shared['editor:selection']">
    <span class="what">Nothing selected</span>
    <span class="how">Pick a node in the scene tree or the viewport.</span>
  </div>
  <template $else>
    <div class="node-header">
      <span class="icon" $html="shared['editor:selection'].icon"></span>
      <input class="node-name" type="text" aria-label="Node name" $model="state.name" @change="rename" />
      <span class="type">{{ shared['editor:selection'].type }}<span $if="shared['editor:selection'].count > 1"> · {{ shared['editor:selection'].count }} selected</span></span>
    </div>
    <div class="actions" $if="shared['editor:selection'].actions && shared['editor:selection'].actions.length && shared['editor:selection'].count === 1">
      <button class="button small" type="button" $for="action in shared['editor:selection'].actions" $key="action.id" $title="action.title" @click="runAction(action.id)">{{ action.label }}</button>
    </div>
    <section class="section">
      <button class="section-header" type="button" $aria-expanded="state.transformOpen" @click="state.transformOpen = !state.transformOpen"><span class="title">Transform</span></button>
      <div class="section-body" $if="state.transformOpen">
        <div class="properties">
          <span class="label">Position</span>
          <div class="vector">
            <div class="well"><span class="axis x" @pointerdown="scrubTransform($event, 'px', 0.01)">X</span><input type="number" step="0.01" aria-label="Position X" $model="state.px" @change="apply" /></div>
            <div class="well"><span class="axis y" @pointerdown="scrubTransform($event, 'py', 0.01)">Y</span><input type="number" step="0.01" aria-label="Position Y" $model="state.py" @change="apply" /></div>
            <div class="well"><span class="axis z" @pointerdown="scrubTransform($event, 'pz', 0.01)">Z</span><input type="number" step="0.01" aria-label="Position Z" $model="state.pz" @change="apply" /></div>
          </div>
          <span class="label">Rotation</span>
          <div class="vector">
            <div class="well"><span class="axis x" @pointerdown="scrubTransform($event, 'rx', 1)">X</span><input type="number" step="1" aria-label="Rotation X" $model="state.rx" @change="apply" /><span class="unit">°</span></div>
            <div class="well"><span class="axis y" @pointerdown="scrubTransform($event, 'ry', 1)">Y</span><input type="number" step="1" aria-label="Rotation Y" $model="state.ry" @change="apply" /><span class="unit">°</span></div>
            <div class="well"><span class="axis z" @pointerdown="scrubTransform($event, 'rz', 1)">Z</span><input type="number" step="1" aria-label="Rotation Z" $model="state.rz" @change="apply" /><span class="unit">°</span></div>
          </div>
        </div>
      </div>
    </section>
    <section class="section" $if="state.fields.length">
      <button class="section-header" type="button" $aria-expanded="state.propertiesOpen" @click="state.propertiesOpen = !state.propertiesOpen"><span class="title">{{ shared['editor:selection'].type }}</span></button>
      <div class="section-body" $if="state.propertiesOpen">
        <div class="properties">
          <template $for="field in state.fields" $key="field.key">
            <label class="label" $class="{ scrub: field.type === 'number' }" $title="field.label" @pointerdown="scrubField($event, field)">{{ field.label }}</label>
            <div class="control">
              <div class="well" $if="field.type === 'number'">
                <span class="fill" $if="field.ranged" $style="'width: ' + Math.min(100, Math.max(0, (field.value - field.min) / (field.max - field.min) * 100)) + '%'"></span>
                <input type="number" $aria-label="field.label" $step="field.step" $min="field.min" $max="field.max" $model="field.value" @change="applyField(field)" />
              </div>
              <input $else-if="field.type === 'boolean'" class="checkbox" type="checkbox" $aria-label="field.label" $model="field.value" @change="applyField(field)" />
              <div class="well tags" $else-if="field.type === 'tags'">
                <span class="chip" $for="tag in field.value" $key="tag">
                  {{ tag }}<button class="remove" type="button" aria-label="Remove tag" @click="removeTag(field, tag)">×</button>
                </span>
                <input
                  type="text"
                  placeholder="add tag"
                  $aria-label="field.label"
                  @keydown="tagKey($event, field)"
                  @blur="addTagFrom($event.target, field)"
                />
              </div>
              <div class="layers" $else-if="field.type === 'layers'">
                <button
                  class="layer"
                  type="button"
                  $for="n in state.layerNumbers"
                  $key="n"
                  $aria-pressed="field.value.includes(n)"
                  @click="toggleLayer(field, n)"
                >{{ n }}</button>
              </div>
              <label class="well colour" $else-if="field.type === 'colour'">
                <input class="swatch" type="color" $aria-label="field.label" $model="field.hex" @input="applyColour($event, field)" />
                <span class="mono">{{ field.hex }}</span>
              </label>
              <select $else-if="field.type === 'select'" class="well" $aria-label="field.label" $disabled="field.readonly" @change="applySelect($event, field)">
                <template $for="choice in field.options" $key="choice">
                  <option $value="choice" $selected="choice === field.value">{{ choice }}</option>
                </template>
              </select>
              <button $else-if="field.type === 'file'" class="well file-pick" type="button" $class="{ missing: field.missing, droppable: field.droppable, over: field.over }" $aria-label="field.label" $title="field.value || 'None'" $disabled="field.readonly" @click="openFile($event, field)" @dragover="fileOver($event, field)" @dragleave="field.over = false" @drop="dropFile($event, field)">
                <span class="file-name" $class="{ empty: !field.value }">{{ field.display }}</span>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg>
              </button>
              <input $else class="well" type="text" $aria-label="field.label" $model="field.value" $disabled="field.readonly" @change="applyField(field)" />
            </div>
          </template>
        </div>
      </div>
    </section>
    <section class="section" $class="{ drop: state.dropping }">
      <button class="section-header" type="button" $aria-expanded="state.scriptsOpen" @click="state.scriptsOpen = !state.scriptsOpen"><span class="title">Scripts</span><span class="count">{{ state.scripts.length }}</span></button>
      <div class="section-body" $if="state.scriptsOpen">
        <div class="script" $for="script in state.scripts" $key="script.index">
          <div class="well slot">
            <svg class="slot-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M3.5 1.5h6l3 3v10h-9z"/><path d="m7 8-1.5 1.5L7 11M9 8l1.5 1.5L9 11"/></svg>
            <span class="script-name mono" $title="script.url">{{ script.name }}</span>
            <span class="hint" $if="!script.built">not built</span>
            <button class="icon-button small" type="button" title="Open in the code pane" aria-label="Open in the code pane" @click="editScript(script)">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7 9M11 9.5v4H2.5V5h4"/></svg>
            </button>
            <button class="icon-button small" type="button" title="Detach script" aria-label="Detach script" @click="detachScript(script)">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>
            </button>
          </div>
          <div class="properties">
            <template $for="field in script.fields" $key="field.key">
              <label class="label" $class="{ scrub: field.type === 'number' }" $title="field.label" @pointerdown="scrubScriptField($event, script, field)">{{ field.label }}</label>
              <div class="control">
                <div class="well" $if="field.type === 'number'">
                  <span class="fill" $if="field.ranged" $style="'width: ' + Math.min(100, Math.max(0, (field.value - field.min) / (field.max - field.min) * 100)) + '%'"></span>
                  <input type="number" $aria-label="field.label" $step="field.step" $min="field.min" $max="field.max" $model="field.value" @change="applyScriptField(script, field)" />
                </div>
                <input $else-if="field.type === 'boolean'" class="checkbox" type="checkbox" $aria-label="field.label" $model="field.value" @change="applyScriptField(script, field)" />
                <label class="well colour" $else-if="field.type === 'colour'">
                  <input class="swatch" type="color" $aria-label="field.label" $model="field.hex" @input="applyScriptColour($event, script, field)" />
                  <span class="mono">{{ field.hex }}</span>
                </label>
                <button $else-if="field.type === 'file'" class="well file-pick" type="button" $class="{ missing: field.missing, droppable: field.droppable, over: field.over }" $aria-label="field.label" $title="field.value || 'None'" $disabled="field.readonly" @click="openScriptFile($event, script, field)" @dragover="fileOver($event, field)" @dragleave="field.over = false" @drop="dropScriptFile($event, script, field)">
                  <span class="file-name" $class="{ empty: !field.value }">{{ field.display }}</span>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg>
                </button>
                <input $else class="well" type="text" $aria-label="field.label" $model="field.value" $disabled="field.readonly" @change="applyScriptField(script, field)" />
              </div>
            </template>
          </div>
        </div>
        <div class="attach" $if="shared['editor:scripts'].length">
          <span class="well select">
            <select aria-label="Script to attach" $model="state.attachPath">
              <option $for="file in shared['editor:scripts']" $key="file.path" $value="file.path" $label="file.name">{{ file.name }}</option>
            </select>
          </span>
          <button class="button small" @click="attachScript()">Attach</button>
        </div>
        <div class="attach">
          <input class="well" type="text" placeholder="New script class name" aria-label="New script class name" $model="state.newScriptName" @keydown="newScriptKey($event)" />
          <button class="button small" @click="newScript()">New</button>
        </div>
        <div class="buttons" $if="state.scripts.length">
          <button class="button small" @click="send('reloadScripts')">Reload scripts</button>
        </div>
      </div>
    </section>
  </template>
</div>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { SCRIPTS_DEFAULT } from '../cells.ts'
import { scrub } from '../scrub.ts'
import { DRAGGING_FILE_CELL, accepts, basename, openFilePicker } from '../fileField.ts'

const selection = shared('editor:selection', null)
const scriptFiles = shared('editor:scripts', SCRIPTS_DEFAULT)
const dragging = shared(DRAGGING_FILE_CELL, null)

// Local copies of the fields, so typing doesn't fight the scene publishing
// the same values back on every gizmo move
interface Field { key: string; label: string; type: string; value: number | boolean | string | string[] | number[]; min?: number; max?: number; step?: number; options?: string[]; readonly?: boolean; hex?: string; ranged?: boolean; choices?: string[]; display?: string; missing?: boolean; droppable?: boolean; over?: boolean }
interface ScriptEntry { index: number; url: string; name: string; built: boolean; fields: Field[] }

const state = reactive({
  dropping: false,
  name: '',
  px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0,
  fields: [] as Field[],
  scripts: [] as ScriptEntry[],
  attachPath: '',
  newScriptName: '',
  transformOpen: true,
  propertiesOpen: true,
  scriptsOpen: true,
  layerNumbers: Array.from({ length: 32 }, (_, n) => n),
})

const local = (field: Field): Field => ({
  ...field,
  hex: field.type === 'colour' ? toHex(field.value) : undefined,
  ranged: field.type === 'number' && field.min !== undefined && field.max !== undefined,
  ...fileDisplay(field),
})

scriptFiles.subscribe((files: { path: string }[]) => {
  if (!files.some((file) => file.path === state.attachPath)) state.attachPath = files[0]?.path ?? ''
})

selection.subscribe((next: any) => {
  if (!next) return
  state.name = next.name
  state.px = next.position.x
  state.py = next.position.y
  state.pz = next.position.z
  state.rx = next.rotation.x
  state.ry = next.rotation.y
  state.rz = next.rotation.z
  state.fields = (next.properties ?? []).map(local)
  state.scripts = (next.scripts ?? []).map((script: ScriptEntry) => ({ ...script, fields: script.fields.map(local) }))
  markAllDroppable(dragging.value ?? null)
})

function applyScriptField(script: ScriptEntry, field: Field) {
  sendCommand({ type: 'setScriptProperty', index: script.index, key: field.key, value: field.value })
}

function applyScriptColour(event: Event, script: ScriptEntry, field: Field) {
  field.hex = (event.target as HTMLInputElement).value
  field.value = parseInt(field.hex.slice(1), 16)
  applyScriptField(script, field)
}

function editScript(script: ScriptEntry) {
  sendCommand({ type: 'openScript', path: script.url })
}

function detachScript(script: ScriptEntry) {
  sendCommand({ type: 'detachScript', index: script.index })
}

// A script dragged from the files pane onto the inspector attaches to the selected node
const SCRIPT_FILE = /\.(ts|js)$/i

function scriptOver(event: DragEvent) {
  if (!selection.value || !event.dataTransfer?.types.includes('text/catalyst-file')) return
  if (dragging.value && !SCRIPT_FILE.test(dragging.value)) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'link'
  state.dropping = true
}

function scriptLeave(event: DragEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) state.dropping = false
}

function scriptDrop(event: DragEvent) {
  state.dropping = false
  const path = event.dataTransfer?.getData('text/catalyst-file')
  if (!path || !selection.value) return
  event.preventDefault()
  if (!SCRIPT_FILE.test(path)) return
  state.scriptsOpen = true
  sendCommand({ type: 'attachScript', url: path })
}

function attachScript() {
  if (state.attachPath) sendCommand({ type: 'attachScript', url: state.attachPath })
}

function newScript() {
  const name = state.newScriptName.trim()
  if (!name) return
  sendCommand({ type: 'newScript', name })
  state.newScriptName = ''
}

function newScriptKey(event: KeyboardEvent) {
  if (event.key === 'Enter') newScript()
}

function send(type: string) {
  sendCommand({ type })
}

// Names are what the manifest's activation rules and the scene files key on,
// so a rename has to be a deliberate change
function rename() {
  sendCommand({ type: 'rename', name: state.name })
}

function runAction(id: string) {
  sendCommand({ type: 'nodeAction', id })
}

function applySelect(event: Event, field: Field) {
  field.value = (event.target as HTMLSelectElement).value
  applyField(field)
}

function applyField(field: Field) {
  sendCommand({ type: 'setProperty', key: field.key, value: field.value })
}

// A file dragged from the files pane lights up the fields that take it; a drop on one points it there
function fileOver(event: DragEvent, field: Field) {
  if (!field.droppable || !event.dataTransfer) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'link'
  field.over = true
}

function droppedFile(event: DragEvent, field: Field): string | null {
  field.over = false
  const path = event.dataTransfer?.getData('text/catalyst-file')
  if (!field.droppable || !path) return null
  event.preventDefault()
  event.stopPropagation()
  return path
}

function markDroppable(fields: Field[], path: string | null) {
  for (const field of fields) {
    if (field.type !== 'file') continue
    field.droppable = Boolean(path) && !field.readonly && accepts(field.accept, path!)
    field.over = false
  }
}

function markAllDroppable(path: string | null) {
  markDroppable(state.fields, path)
  for (const script of state.scripts) markDroppable(script.fields, path)
}

dragging.subscribe((path: string | null | undefined) => markAllDroppable(path ?? null))

function dropFile(event: DragEvent, field: Field) {
  const path = droppedFile(event, field)
  if (!path) return
  field.value = path
  applyField(field)
}

function dropScriptFile(event: DragEvent, script: ScriptEntry, field: Field) {
  const path = droppedFile(event, field)
  if (!path) return
  field.value = path
  applyScriptField(script, field)
}

function fileDisplay(field: Field) {
  if (field.type !== 'file') return {}
  const value = typeof field.value === 'string' ? field.value : ''
  return { display: value ? basename(value) : 'None', missing: Boolean(value) && !(field.choices ?? []).includes(value) }
}

function openFile(event: Event, field: Field) {
  openFilePicker({
    trigger: event.currentTarget as HTMLElement,
    value: typeof field.value === 'string' ? field.value : null,
    choices: field.choices ?? [],
    pick: (path) => {
      field.value = path ?? ''
      applyField(field)
    },
    importFile: () => sendCommand({ type: 'setProperty', key: field.key, value: null, pick: true }),
  })
}

function openScriptFile(event: Event, script: ScriptEntry, field: Field) {
  openFilePicker({
    trigger: event.currentTarget as HTMLElement,
    value: typeof field.value === 'string' ? field.value : null,
    choices: field.choices ?? [],
    pick: (path) => {
      field.value = path ?? ''
      applyScriptField(script, field)
    },
    importFile: () => sendCommand({ type: 'setScriptProperty', index: script.index, key: field.key, value: null, pick: true }),
  })
}

function toHex(value: unknown): string {
  return `#${(Number(value) >>> 0 & 0xffffff).toString(16).padStart(6, '0')}`
}

function applyColour(event: Event, field: Field) {
  field.hex = (event.target as HTMLInputElement).value
  field.value = parseInt(field.hex.slice(1), 16)
  applyField(field)
}

function removeTag(field: Field, tag: string) {
  field.value = (field.value as string[]).filter((t) => t !== tag)
  applyField(field)
}

function addTagFrom(input: HTMLInputElement, field: Field) {
  const tag = input.value.trim()
  input.value = ''
  const tags = field.value as string[]
  if (!tag || tags.includes(tag)) return
  field.value = [...tags, tag]
  applyField(field)
}

function tagKey(event: KeyboardEvent, field: Field) {
  if (event.key !== 'Enter' && event.key !== ',') return
  event.preventDefault()
  addTagFrom(event.target as HTMLInputElement, field)
}

function toggleLayer(field: Field, layer: number) {
  const layers = field.value as number[]
  field.value = layers.includes(layer)
    ? layers.filter((l) => l !== layer)
    : [...layers, layer].sort((a, b) => a - b)
  applyField(field)
}

// The input a scrub handle drives: inside the same well (an axis letter), or
// in the control beside it (a property's label)
function inputOf(event: PointerEvent): HTMLInputElement | null {
  const handle = event.currentTarget as HTMLElement
  return handle.closest('.well')?.querySelector('input') ?? handle.nextElementSibling?.querySelector('input') ?? null
}

type TransformKey = 'px' | 'py' | 'pz' | 'rx' | 'ry' | 'rz'

function scrubTransform(event: PointerEvent, key: TransformKey, step: number) {
  scrub(event, {
    read: () => state[key],
    write: (value) => {
      state[key] = value
      apply()
    },
    step,
    input: inputOf(event),
  })
}

function scrubNumber(event: PointerEvent, field: Field, commit: () => void) {
  if (field.type !== 'number') return
  scrub(event, {
    read: () => Number(field.value),
    write: (value) => {
      field.value = value
      commit()
    },
    step: field.step ?? 0.01,
    min: field.min,
    max: field.max,
    input: inputOf(event),
  })
}

function scrubField(event: PointerEvent, field: Field) {
  scrubNumber(event, field, () => applyField(field))
}

function scrubScriptField(event: PointerEvent, script: ScriptEntry, field: Field) {
  scrubNumber(event, field, () => applyScriptField(script, field))
}

function apply() {
  sendCommand({
    type: 'setTransform',
    position: { x: Number(state.px), y: Number(state.py), z: Number(state.pz) },
    rotation: { x: Number(state.rx), y: Number(state.ry), z: Number(state.rz) },
  })
}
</logic>

<style>
.hint {
  color: var(--cat-text-tertiary);
}

.node-header {
  display: flex;
  align-items: center;
  gap: var(--cat-space-2);
  padding: calc(var(--cat-space-2) + var(--cat-space-0-5)) var(--cat-space-3);
  border-bottom: 1px solid var(--cat-border-subtle);
}

.node-header .icon {
  flex: 0 0 var(--cat-icon);
  width: var(--cat-icon);
  height: var(--cat-icon);
  color: var(--cat-accent);
}

.node-header .icon :global(svg) {
  display: block;
  width: var(--cat-icon);
  height: var(--cat-icon);
}

.node-name {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--cat-h-sm);
  padding: 0 var(--cat-space-1-5);
  box-sizing: border-box;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--cat-radius-sm);
  font: 500 var(--cat-text-md) / var(--cat-leading-body) var(--cat-font-ui);
  outline: none;
}

.node-name:hover {
  border-color: var(--cat-border-strong);
}

.node-name:focus {
  background: var(--cat-bg-app);
  border-color: var(--cat-accent);
}

.type {
  flex: 0 0 auto;
  color: var(--cat-text-tertiary);
  font: var(--cat-text-xs) / var(--cat-leading-tight) var(--cat-font-mono);
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cat-space-1);
}

.control > .well:not(.colour) {
  flex: 1 1 auto;
}

.tags {
  flex-wrap: wrap;
  height: auto;
  min-height: var(--cat-h-sm);
  padding: var(--cat-space-0-5);
  gap: var(--cat-space-0-5);
}

.tags input {
  flex: 1 1 48px;
  height: var(--cat-h-xs);
  padding: 0 var(--cat-space-1);
  font-size: var(--cat-text-xs);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--cat-space-0-5);
  height: 18px;
  padding: 0 var(--cat-space-0-5) 0 var(--cat-space-1-5);
  background: var(--cat-bg-active);
  border-radius: var(--cat-radius-xs);
  font-size: var(--cat-text-xs);
}

.chip .remove {
  padding: 0 var(--cat-space-0-5);
  background: none;
  border: none;
  color: var(--cat-text-secondary);
  line-height: 1;
  cursor: pointer;
}

.chip .remove:hover {
  color: var(--cat-text-primary);
}

.colour {
  gap: var(--cat-space-2);
  padding-left: var(--cat-space-1);
  cursor: pointer;
}

.colour .swatch {
  flex: 0 0 32px;
  width: 32px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: var(--cat-radius-xs);
  background: none;
  cursor: pointer;
}

.colour .swatch::-webkit-color-swatch-wrapper {
  padding: 0;
}

.colour .swatch::-webkit-color-swatch {
  border: 0;
  border-radius: var(--cat-radius-xs);
}

.layers {
  display: grid;
  grid-template-columns: repeat(8, 22px);
  gap: 3px;
  padding: var(--cat-space-0-5) 0;
}

.layer {
  width: 22px;
  height: 22px;
  padding: 0;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-xs);
  color: var(--cat-text-secondary);
  font: var(--cat-text-xs) / 1 var(--cat-font-mono);
  cursor: pointer;
}

.layer:hover {
  border-color: var(--cat-border-strong);
}

.layer[aria-pressed="true"] {
  background: var(--cat-text-primary);
  border-color: var(--cat-text-primary);
  color: var(--cat-text-on-accent);
}

.script {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-2);
}

.slot {
  padding-right: var(--cat-space-0-5);
}

.slot-icon {
  flex: 0 0 var(--cat-icon-sm);
  width: var(--cat-icon-sm);
  height: var(--cat-icon-sm);
  color: var(--cat-text-secondary);
}

.script-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach {
  display: flex;
  gap: var(--cat-space-1);
}

.attach > .well {
  flex: 1 1 auto;
}
.section.drop {
  box-shadow: inset 0 0 0 1px var(--cat-accent);
  border-radius: var(--cat-radius-sm);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cat-space-1-5);
  padding: 0 var(--cat-space-3) var(--cat-space-2);
}
</style>
