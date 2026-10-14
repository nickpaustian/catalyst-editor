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
    <div class="row" $if="shared['editor:selection'].isPoi">
      <span class="hint">content </span>
      <select @change="setContent($event)">
        <option value="" $selected="!shared['editor:selection'].contentId">(none)</option>
        <option
          $for="id in shared['editor:selection'].contentOptions"
          $key="id"
          $value="id"
          $selected="id === shared['editor:selection'].contentId"
        >{{ id }}</option>
      </select>
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
        <input $else type="text" $model="field.value" @change="applyField(field)" />
      </div>
    </div>
  </template>
</div>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

const selection = shared('editor:selection', null)

// Local copies of the fields, so typing doesn't fight the scene publishing
// the same values back on every gizmo move
interface Field { key: string; label: string; type: string; value: number | boolean | string; min?: number; max?: number; step?: number }

const state = reactive({ name: '', px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, fields: [] as Field[] })

selection.subscribe((next: any) => {
  if (!next) return
  state.name = next.name
  state.px = next.position.x
  state.py = next.position.y
  state.pz = next.position.z
  state.rx = next.rotation.x
  state.ry = next.rotation.y
  state.rz = next.rotation.z
  state.fields = (next.properties ?? []).map((field: Field) => ({ ...field }))
})

function send(type: string) {
  sendCommand({ type })
}

// Names are what the manifest's activation rules and the scene files key on,
// so a rename has to be a deliberate change
function rename() {
  sendCommand({ type: 'rename', name: state.name })
}

function setContent(event: Event) {
  sendCommand({ type: 'setContent', id: (event.target as HTMLSelectElement).value })
}

function applyField(field: Field) {
  sendCommand({ type: 'setProperty', key: field.key, value: field.value })
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
  color: #888;
  font-size: 11px;
  margin: 4px 0;
}

.row {
  margin: 2px 0;
}

.type {
  display: flex;
  align-items: center;
  gap: 5px;
}

.icon {
  width: 14px;
  height: 14px;
  color: #8fa3c7;
}

.icon :global(svg) {
  display: block;
  width: 14px;
  height: 14px;
}

label {
  display: inline-block;
  width: 18px;
  color: #999;
}

input,
select,
button {
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 6px;
}

input[type="number"] {
  width: 64px;
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
  border-color: #6a8bd0;
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

button {
  cursor: pointer;
  margin: 0 4px 4px 0;
}
</style>
