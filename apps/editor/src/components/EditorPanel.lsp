<view>
<aside class="panel">
  <h1 class="title">Vitrine</h1>

  <select class="picker" @change="switchTo($event)">
    <option
      $for="entry in shared['editor:exhibition'].catalogue"
      $key="entry.id"
      $value="entry.id"
      $selected="entry.id === shared['editor:exhibition'].id"
    >{{ entry.title }}</option>
  </select>

  <h2>Folder</h2>
  <div class="buttons">
    <button @click="send('openFolder')">Open folder…</button>
    <button @click="send('reopenLast')">Reopen last</button>
    <button @click="send('save')">Save</button>
    <button @click="send('saveAs')">Save as…</button>
  </div>
  <p class="hint">
    <span $if="shared['editor:folder'].name">Folder: {{ shared['editor:folder'].name }}</span>
    <span $if="shared['editor:folder'].status"> {{ shared['editor:folder'].status }}</span>
  </p>

  <h2>View</h2>
  <div class="buttons">
    <button $class="{ on: shared['editor:view'].view === 'orbit' }" @click="setView('orbit')">Orbit</button>
    <button $class="{ on: shared['editor:view'].view === 'firstPerson' }" @click="setView('firstPerson')">First person</button>
    <button $class="{ on: shared['editor:view'].view === 'guided' }" @click="setView('guided')">Guided</button>
  </div>
  <div class="buttons">
    <button $class="{ on: shared['editor:view'].visualised }" @click="send('toggleVisualisers')">Visualisers</button>
    <button $class="{ on: shared['editor:view'].moveMode }" @click="send('toggleMoveMode')">Move mode (o)</button>
    <button $class="{ on: shared['editor:view'].gizmo === 'translate' }" @click="setGizmo('translate')">Translate</button>
    <button $class="{ on: shared['editor:view'].gizmo === 'rotate' }" @click="setGizmo('rotate')">Rotate</button>
  </div>
  <p class="hint">
    Orbit: drag to orbit, right-drag to pan, wheel to zoom; F focuses the selected node; drag the gizmo to move it.
    First person: WASD, click to look. Move mode: look at a node and press F to pick it up, F again to drop.
  </p>

  <RailSection />

  <NodeGroup $for="group in shared['editor:groups']" $key="group.key" $group="group" />

  <h2>Selected</h2>
  <SelectionFields />

  <ContentSection />

  <PresentationSection />

  <h2>Export</h2>
  <div class="buttons">
    <button @click="send('exportScene')">Scene files</button>
    <button @click="send('exportManifest')">Manifest</button>
  </div>
  <p class="hint">
    Scene files are the loaded JSON with live transforms written back by node name.
    The manifest carries the live rail control points.
  </p>
</aside>
</view>

<logic lang="ts">
import { shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

// Every cell the view reads, declared so a cell that hasn't been published
// yet renders as empty rather than throwing
shared('editor:exhibition', { id: '', title: '', catalogue: [] })
shared('editor:folder', { name: null, status: '', supported: false })
shared('editor:view', { view: 'guided', visualised: false, moveMode: false, gizmo: 'translate' })
shared('editor:groups', [])

function send(type: string) {
  sendCommand({ type })
}

function setView(view: string) {
  sendCommand({ type: 'setView', view })
}

function setGizmo(mode: string) {
  sendCommand({ type: 'setGizmo', mode })
}

function switchTo(event: Event) {
  sendCommand({ type: 'switch', id: (event.target as HTMLSelectElement).value })
}
</logic>

<style>
.panel {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 12px;
  background: #101010;
  color: #eee;
  font: 12px/1.4 "IBM Plex Sans", system-ui, sans-serif;
}

.title {
  font-size: 14px;
  margin: 0 0 8px;
}

h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #999;
  margin: 14px 0 4px;
}

.picker,
button {
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 6px;
}

button {
  cursor: pointer;
  margin: 0 4px 4px 0;
}

button:hover {
  background: #333;
}

button.on {
  border-color: #6a8fd8;
  background: #2a3650;
}

.hint {
  color: #888;
  font-size: 11px;
  margin: 4px 0;
}
</style>
