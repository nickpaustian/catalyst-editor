<view>
<section class="rail">
  <h2>Rail</h2>
  <div class="buttons">
    <button $class="{ on: shared['editor:rail'].shown }" @click="send('railToggleShown')">Show rail</button>
    <button @click="send('railToggleCamera')">
      {{ shared['editor:rail'].cameraSource === 'baked' ? 'Camera: baked path' : 'Camera: live rail' }}
    </button>
    <button $class="{ on: shared['editor:rail'].recording }" @click="send('railToggleRecording')">
      {{ shared['editor:rail'].recording ? 'Stop recording' : 'Record baked path' }}
    </button>
  </div>
  <p class="hint">
    In guided view with the rail driving, scroll previews the live rail.
    Recording follows the rail to the end and keeps the result for the next save.
  </p>
  <div class="list">
    <div
      class="item"
      $for="point in shared['editor:rail'].points"
      $key="point.index"
      $class="{ selected: point.selected }"
      @click="select(point)"
    >{{ point.index }}  {{ point.name }}</div>
  </div>
  <template $if="shared['editor:rail'].selected">
    <div class="row">
      <input type="text" placeholder="name" $model="state.name" @change="rename" />
    </div>
    <div class="row">
      <span class="hint">pos </span>
      <label>x</label><input type="number" step="0.01" $model="state.x" @change="apply" />
      <label>y</label><input type="number" step="0.01" $model="state.y" @change="apply" />
      <label>z</label><input type="number" step="0.01" $model="state.z" @change="apply" />
    </div>
    <div class="buttons">
      <button @click="send('railAddAfter')">Add after</button>
      <button @click="send('railDelete')">Delete point</button>
      <button @click="send('railFocus')">Focus point</button>
    </div>
  </template>
</section>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

const rail = shared('editor:rail', {
  shown: false,
  cameraSource: 'baked',
  recording: false,
  points: [],
  selected: null,
})

const state = reactive({ name: '', x: 0, y: 0, z: 0 })

rail.subscribe((next: any) => {
  const cp = next?.selected
  if (!cp) return
  state.name = cp.name
  state.x = cp.x
  state.y = cp.y
  state.z = cp.z
})

function send(type: string) {
  sendCommand({ type })
}

function select(point: { index: number }) {
  sendCommand({ type: 'railSelect', index: point.index })
}

function rename() {
  sendCommand({ type: 'railRename', name: state.name })
}

function apply() {
  sendCommand({ type: 'railSetPosition', x: Number(state.x), y: Number(state.y), z: Number(state.z) })
}
</logic>

<style>
h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #999;
  margin: 14px 0 4px;
}

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

button {
  cursor: pointer;
  margin: 0 4px 4px 0;
}

button.on {
  border-color: #6a8fd8;
  background: #2a3650;
}

.list {
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid #333;
  margin-bottom: 6px;
}

.item {
  padding: 2px 6px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item:hover {
  background: #2a2a2a;
}

.item.selected {
  background: #3a4a6a;
}
</style>
