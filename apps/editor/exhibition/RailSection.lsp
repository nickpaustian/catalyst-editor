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
  font-size: var(--cat-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cat-text-secondary);
  margin: var(--cat-space-3) 0 var(--cat-space-1);
}

.hint {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
  margin: var(--cat-space-1) 0;
}

.row {
  margin: var(--cat-space-0-5) 0;
}

label {
  display: inline-block;
  width: 18px;
  color: var(--cat-text-secondary);
}

input,
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
}

button {
  cursor: pointer;
  margin: 0 var(--cat-space-1) var(--cat-space-1) 0;
}

button.on {
  border-color: var(--cat-border-strong);
  background: var(--cat-bg-active);
}

.list {
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid var(--cat-border);
  margin-bottom: var(--cat-space-1-5);
}

.item {
  padding: var(--cat-space-0-5) var(--cat-space-1-5);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item:hover {
  background: var(--cat-bg-hover);
}

.item.selected {
  background: var(--cat-accent-soft);
}
</style>
