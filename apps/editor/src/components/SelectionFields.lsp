<view>
<div class="selection">
  <p class="hint" $if="!shared['editor:selection']">Nothing selected</p>
  <template $else>
    <p class="hint">{{ shared['editor:selection']?.type }}</p>
    <div class="row">
      <input class="name" type="text" $model="state.name" @change="rename" />
    </div>
    <div class="buttons">
      <button @click="send('focus')">Focus</button>
      <button @click="send('delete')">Delete</button>
    </div>
    <div class="row" $if="shared['editor:selection']?.isPoi">
      <span class="hint">content </span>
      <select @change="setContent($event)">
        <option value="" $selected="!shared['editor:selection']?.contentId">(none)</option>
        <option
          $for="id in shared['editor:selection']?.contentOptions"
          $key="id"
          $value="id"
          $selected="id === shared['editor:selection']?.contentId"
        >{{ id }}</option>
      </select>
    </div>
    <div class="row">
      <span class="hint">pos </span>
      <label>x</label><input type="number" step="0.01" $model="state.px" @change="apply" />
      <label>y</label><input type="number" step="0.01" $model="state.py" @change="apply" />
      <label>z</label><input type="number" step="0.01" $model="state.pz" @change="apply" />
    </div>
    <div class="row">
      <span class="hint">rot° </span>
      <label>x</label><input type="number" step="1" $model="state.rx" @change="apply" />
      <label>y</label><input type="number" step="1" $model="state.ry" @change="apply" />
      <label>z</label><input type="number" step="1" $model="state.rz" @change="apply" />
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
