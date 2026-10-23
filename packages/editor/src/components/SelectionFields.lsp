<view>
<div class="selection">
  <p class="hint" $if="!shared['editor:selection']">Nothing selected</p>
  <template $else>
    <p class="hint type"><span class="icon" $html="shared['editor:selection'].icon"></span>{{ shared['editor:selection'].type }}<span $if="shared['editor:selection'].count > 1"> · {{ shared['editor:selection'].count }} selected</span></p>
    <div class="row">
      <input class="name" type="text" $model="state.name" @change="rename" />
    </div>
    <div class="buttons">
      <button @click="send('focus')">Focus</button>
      <button @click="send('delete')">Delete</button>
    </div>
    <div class="row">
      <span class="hint">pos </span>
      <label>x</label><input type="number" step="0.01" $model="state.px" @change="apply" @pointerdown="scrubTransform($event, 'px', 0.01)" />
      <label>y</label><input type="number" step="0.01" $model="state.py" @change="apply" @pointerdown="scrubTransform($event, 'py', 0.01)" />
      <label>z</label><input type="number" step="0.01" $model="state.pz" @change="apply" @pointerdown="scrubTransform($event, 'pz', 0.01)" />
    </div>
    <div class="row">
      <span class="hint">rot° </span>
      <label>x</label><input type="number" step="1" $model="state.rx" @change="apply" @pointerdown="scrubTransform($event, 'rx', 1)" />
      <label>y</label><input type="number" step="1" $model="state.ry" @change="apply" @pointerdown="scrubTransform($event, 'ry', 1)" />
      <label>z</label><input type="number" step="1" $model="state.rz" @change="apply" @pointerdown="scrubTransform($event, 'rz', 1)" />
    </div>
    <div class="properties">
      <div class="row property" $for="field in state.fields" $key="field.key">
        <label class="property-label">{{ field.label }}</label>
        <input
          $if="field.type === 'number'"
          type="number"
          $step="field.step"
          $min="field.min"
          $max="field.max"
          $model="field.value"
          @change="applyField(field)"
          @pointerdown="scrubField($event, field)"
        />
        <input
          $else-if="field.type === 'boolean'"
          type="checkbox"
          $model="field.value"
          @change="applyField(field)"
        />
        <div class="tags" $else-if="field.type === 'tags'">
          <span class="chip" $for="tag in field.value" $key="tag">
            {{ tag }}<button class="remove" title="Remove tag" @click="removeTag(field, tag)">×</button>
          </span>
          <input
            class="tag-input"
            type="text"
            placeholder="add tag"
            @keydown="tagKey($event, field)"
            @blur="addTagFrom($event.target, field)"
          />
        </div>
        <div class="layers" $else-if="field.type === 'layers'">
          <button
            class="layer"
            $for="n in state.layerNumbers"
            $key="n"
            $class="{ on: field.value.includes(n) }"
            @click="toggleLayer(field, n)"
          >{{ n }}</button>
        </div>
        <span class="colour" $else-if="field.type === 'colour'">
          <input type="color" $value="field.hex" @input="applyColour($event, field)" />
          <span class="hex">{{ field.hex }}</span>
        </span>
        <input $else type="text" $model="field.value" $disabled="field.readonly" @change="applyField(field)" />
      </div>
    </div>
    <div class="scripts">
      <h3>Scripts</h3>
      <div class="script" $for="script in state.scripts" $key="script.index">
        <div class="row script-head">
          <span class="script-name" $title="script.url">{{ script.name }}</span>
          <span class="hint" $if="!script.built">not built</span>
          <button class="small" title="Open in the code pane" @click="editScript(script)">Edit</button>
          <button class="remove" title="Detach script" @click="detachScript(script)">×</button>
        </div>
        <div class="row property" $for="field in script.fields" $key="field.key">
          <label class="property-label">{{ field.label }}</label>
          <input $if="field.type === 'number'" type="number" $step="field.step" $min="field.min" $max="field.max" $model="field.value" @change="applyScriptField(script, field)" />
          <input $else-if="field.type === 'boolean'" type="checkbox" $model="field.value" @change="applyScriptField(script, field)" />
          <span class="colour" $else-if="field.type === 'colour'">
            <input type="color" $value="field.hex" @input="applyScriptColour($event, script, field)" />
            <span class="hex">{{ field.hex }}</span>
          </span>
          <input $else type="text" $model="field.value" $disabled="field.readonly" @change="applyScriptField(script, field)" />
        </div>
      </div>
      <div class="row attach" $if="shared['editor:scripts'].length">
        <select $model="state.attachPath">
          <option $for="file in shared['editor:scripts']" $key="file.path" $value="file.path">{{ file.name }}</option>
        </select>
        <button @click="attachScript()">Attach</button>
      </div>
      <div class="row attach">
        <input class="new-script" type="text" placeholder="New script class name" $model="state.newScriptName" @keydown="newScriptKey($event)" />
        <button @click="newScript()">New</button>
      </div>
      <div class="buttons" $if="state.scripts.length">
        <button @click="send('reloadScripts')">Reload scripts</button>
      </div>
    </div>
  </template>
</div>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { SCRIPTS_DEFAULT } from '../cells.ts'

const selection = shared('editor:selection', null)
const scriptFiles = shared('editor:scripts', SCRIPTS_DEFAULT)

// Local copies of the fields, so typing doesn't fight the scene publishing
// the same values back on every gizmo move
interface Field { key: string; label: string; type: string; value: number | boolean | string | string[] | number[]; min?: number; max?: number; step?: number; readonly?: boolean; hex?: string }
interface ScriptEntry { index: number; url: string; name: string; built: boolean; fields: Field[] }

const state = reactive({
  name: '',
  px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0,
  fields: [] as Field[],
  scripts: [] as ScriptEntry[],
  attachPath: '',
  newScriptName: '',
  layerNumbers: Array.from({ length: 32 }, (_, n) => n),
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
  state.fields = (next.properties ?? []).map((field: Field) => ({ ...field, hex: field.type === 'colour' ? toHex(field.value) : undefined }))
  state.scripts = (next.scripts ?? []).map((script: ScriptEntry) => ({ ...script, fields: script.fields.map((field) => ({ ...field, hex: field.type === 'colour' ? toHex(field.value) : undefined })) }))
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

function applyField(field: Field) {
  sendCommand({ type: 'setProperty', key: field.key, value: field.value })
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

interface Scrub {
  read: () => number
  write: (value: number) => void
  step: number
  min?: number
  max?: number
}

const DRAG_THRESHOLD = 3

// Press and drag sideways to slide the value; a plain click still focuses the
// input for typing. Shift scrubs ten times faster, alt ten times finer.
function scrub(event: PointerEvent, { read, write, step, min, max }: Scrub) {
  if (event.button !== 0) return
  const input = event.currentTarget as HTMLInputElement
  event.preventDefault()

  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1)
  const startX = event.clientX
  let lastX = startX
  let value = Number(read()) || 0
  let dragging = false

  const move = (e: PointerEvent) => {
    if (!dragging) {
      if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD) return
      dragging = true
      lastX = e.clientX
      input.classList.add('scrubbing')
      document.body.classList.add('scrubbing')
    }
    const scale = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    value += (e.clientX - lastX) * step * scale
    lastX = e.clientX
    if (min !== undefined) value = Math.max(min, value)
    if (max !== undefined) value = Math.min(max, value)
    write(Number(value.toFixed(decimals)))
  }

  const end = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    if (dragging) {
      input.classList.remove('scrubbing')
      document.body.classList.remove('scrubbing')
    } else {
      input.focus()
      input.select()
    }
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
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
  })
}

function scrubField(event: PointerEvent, field: Field) {
  scrub(event, {
    read: () => Number(field.value),
    write: (value) => {
      field.value = value
      applyField(field)
    },
    step: field.step ?? 0.01,
    min: field.min,
    max: field.max,
  })
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
  font-size: var(--cat-text-xs);
  margin: var(--cat-space-1) 0;
}

.row {
  margin: var(--cat-space-0-5) 0;
}

.type {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1);
}

.icon {
  width: 14px;
  height: 14px;
  color: var(--cat-text-secondary);
}

.icon :global(svg) {
  display: block;
  width: 14px;
  height: 14px;
}

label {
  display: inline-block;
  width: 18px;
  color: var(--cat-text-secondary);
}

input,
select,
button {
  font: inherit;
  color: inherit;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-0-5) var(--cat-space-1-5);
}

input[type="number"] {
  width: 64px;
  font-family: var(--cat-font-mono);
  font-variant-numeric: tabular-nums;
  cursor: ew-resize;
  appearance: textfield;
  -moz-appearance: textfield;
}

input[type="number"]::-webkit-outer-spin-button,
input[type="number"]::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}

input[type="number"]:focus {
  cursor: text;
}

input[type="number"].scrubbing {
  user-select: none;
  border-color: var(--cat-accent);
}

:global(body.scrubbing) {
  cursor: ew-resize;
  user-select: none;
}

input.name {
  width: 100%;
  box-sizing: border-box;
}

.property-label {
  width: 56px;
  text-transform: capitalize;
}

.property input[type="text"] {
  width: 120px;
}

.row.property:has(.tags),
.row.property:has(.layers) {
  display: flex;
  align-items: flex-start;
}

.row.property:has(.tags) .property-label,
.row.property:has(.layers) .property-label {
  flex: 0 0 56px;
  padding-top: var(--cat-space-1);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--cat-space-0-5);
  flex: 1 1 auto;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--cat-space-0-5);
  background: var(--cat-bg-active);
  border-radius: var(--cat-radius-sm);
  padding: 0 var(--cat-space-0-5) 0 var(--cat-space-1-5);
  font-size: var(--cat-text-xs);
}

.chip .remove {
  background: none;
  border: none;
  padding: 0 var(--cat-space-0-5);
  margin: 0;
  color: var(--cat-text-secondary);
  line-height: 1;
}

.chip .remove:hover {
  color: var(--cat-text-primary);
}

.tag-input {
  width: 64px;
  padding: var(--cat-space-0-5) var(--cat-space-1);
  font-size: var(--cat-text-xs);
}

.colour {
  display: inline-flex;
  align-items: center;
  gap: var(--cat-space-1-5);
}

.colour input[type="color"] {
  width: 32px;
  height: 22px;
  padding: 0 var(--cat-space-0-5);
  cursor: pointer;
}

.hex {
  color: var(--cat-text-secondary);
  font-family: var(--cat-font-mono);
  font-size: var(--cat-text-xs);
}

.scripts {
  margin-top: var(--cat-space-2);
}

.scripts h3 {
  margin: 0 0 var(--cat-space-1);
  font-size: var(--cat-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cat-text-secondary);
}

.script {
  margin: var(--cat-space-1) 0 var(--cat-space-1-5);
  padding: var(--cat-space-1) var(--cat-space-1-5);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
}

.script-head {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1-5);
}

.script-name {
  flex: 1 1 auto;
  font-weight: 600;
}

.script-head .small {
  font: inherit;
  font-size: var(--cat-text-xs);
  color: inherit;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: 0 var(--cat-space-1-5);
  cursor: pointer;
}

.script-head .remove {
  background: none;
  border: none;
  padding: 0 var(--cat-space-0-5);
  color: var(--cat-text-secondary);
  line-height: 1;
  cursor: pointer;
}

.attach {
  display: flex;
  gap: var(--cat-space-1);
}

.attach select,
.attach .new-script {
  flex: 1 1 auto;
  min-width: 0;
}

.layers {
  display: grid;
  grid-template-columns: repeat(8, 22px);
  gap: var(--cat-space-0-5);
}

.layer {
  width: 22px;
  height: 18px;
  padding: 0;
  margin: 0;
  font-size: var(--cat-text-xs);
  color: var(--cat-text-tertiary);
  background: var(--cat-bg-field);
  border-color: var(--cat-border);
}

.layer.on {
  color: var(--cat-text-on-accent);
  background: var(--cat-text-primary);
  border-color: var(--cat-text-primary);
}

button {
  cursor: pointer;
  margin: 0 var(--cat-space-1) var(--cat-space-1) 0;
}
</style>
