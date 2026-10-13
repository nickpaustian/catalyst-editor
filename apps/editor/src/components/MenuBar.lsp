<view>
<header class="bar">
  <span class="brand">Vitrine</span>

  <nav class="menus">
    <div class="menu" $class="{ open: state.open === 'file' }">
      <button class="menu-title" @click="toggle('file')" @pointerenter="hover('file')">File</button>
      <div class="menu-items" $if="state.open === 'file'">
        <button @click="run('openFolder')">Open folder…</button>
        <button @click="run('reopenLast')">Reopen last</button>
        <hr />
        <button @click="run('save')">Save</button>
        <button @click="run('saveAs')">Save as…</button>
        <hr />
        <button @click="run('exportScene')">Export scene file</button>
        <button @click="run('exportManifest')">Export manifest</button>
      </div>
    </div>

    <div class="menu" $class="{ open: state.open === 'view' }">
      <button class="menu-title" @click="toggle('view')" @pointerenter="hover('view')">View</button>
      <div class="menu-items" $if="state.open === 'view'">
        <button $class="{ on: shared['editor:view'].view === 'orbit' }" @click="setView('orbit')">Orbit</button>
        <button $class="{ on: shared['editor:view'].view === 'firstPerson' }" @click="setView('firstPerson')">First person</button>
        <button $class="{ on: shared['editor:view'].view === 'guided' }" @click="setView('guided')">Guided</button>
        <hr />
        <button $class="{ on: shared['editor:view'].visualised }" @click="run('toggleVisualisers')">Visualisers</button>
        <button $class="{ on: shared['editor:view'].moveMode }" @click="run('toggleMoveMode')">Move mode <kbd>o</kbd></button>
        <hr />
        <button $class="{ on: shared['editor:view'].gizmo === 'translate' }" @click="setGizmo('translate')">Gizmo: translate</button>
        <button $class="{ on: shared['editor:view'].gizmo === 'rotate' }" @click="setGizmo('rotate')">Gizmo: rotate</button>
        <hr />
        <button @click="resetLayout()">Reset pane layout</button>
      </div>
    </div>

    <div class="menu" $class="{ open: state.open === 'help' }">
      <button class="menu-title" @click="toggle('help')" @pointerenter="hover('help')">Help</button>
      <div class="menu-items help" $if="state.open === 'help'">
        <p><b>Orbit:</b> drag to orbit, right-drag to pan, wheel to zoom. <kbd>F</kbd> focuses the selected node. Drag the gizmo to move it.</p>
        <p><b>First person:</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>, click to look.</p>
        <p><b>Move mode:</b> look at a node and press <kbd>F</kbd> to pick it up, <kbd>F</kbd> again to drop.</p>
        <p><b>Panes:</b> drag a gutter to resize, a pane title to move it; <b>+</b> adds a pane, <b>×</b> closes one.</p>
      </div>
    </div>
  </nav>

  <span class="status">
    <span $if="shared['editor:folder'].name">{{ shared['editor:folder'].name }}</span>
    <span class="dim" $if="shared['editor:folder'].status">{{ shared['editor:folder'].status }}</span>
  </span>

  <select class="picker" @change="switchTo($event)">
    <option
      $for="entry in shared['editor:exhibition'].catalogue"
      $key="entry.id"
      $value="entry.id"
      $selected="entry.id === shared['editor:exhibition'].id"
    >{{ entry.title }}</option>
  </select>
</header>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { preferences } from '../preferences.ts'

shared('editor:exhibition', { id: '', title: '', catalogue: [] })
shared('editor:folder', { name: null, status: '', supported: false })
shared('editor:view', { view: 'guided', visualised: false, moveMode: false, gizmo: 'translate' })

const state = reactive({ open: null as string | null })

// A press anywhere outside the bar closes the open menu
document.addEventListener('pointerdown', (event) => {
  if (state.open && !(event.target as Element | null)?.closest?.('#menu-bar')) state.open = null
}, true)

function toggle(name: string) {
  state.open = state.open === name ? null : name
}

function hover(name: string) {
  if (state.open && state.open !== name) state.open = name
}

function run(type: string) {
  state.open = null
  sendCommand({ type })
}

function setView(view: string) {
  state.open = null
  sendCommand({ type: 'setView', view })
}

function setGizmo(mode: string) {
  state.open = null
  sendCommand({ type: 'setGizmo', mode })
}

function switchTo(event: Event) {
  sendCommand({ type: 'switch', id: (event.target as HTMLSelectElement).value })
}

function resetLayout() {
  state.open = null
  preferences.resetLayout()
  const panes = (window as any).panes
  if (panes) panes.layout = preferences.layout
}
</logic>

<style>
.bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--menu-bar-height, 30px);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 10px;
  box-sizing: border-box;
  background: #161616;
  border-bottom: 1px solid #2a2a2a;
  color: #ddd;
  font: 12px/1 "IBM Plex Sans", system-ui, sans-serif;
  z-index: 1100;
  user-select: none;
}

.brand {
  font-weight: 600;
  letter-spacing: 0.04em;
}

.picker {
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 4px;
  max-width: 220px;
}

.menus {
  display: flex;
  align-items: stretch;
  align-self: stretch;
}

.menu {
  position: relative;
  display: flex;
  height: 100%;
}

.menu-title {
  display: flex;
  align-items: center;
  height: 100%;
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0 10px;
  cursor: default;
}

.menu-title:hover,
.menu.open .menu-title {
  background: #2a2a2a;
}

.menu-items {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 190px;
  display: flex;
  flex-direction: column;
  padding: 4px;
  background: #222;
  border: 1px solid #444;
  border-radius: 0 0 3px 3px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
}

.menu-items button {
  font: inherit;
  color: #ddd;
  text-align: left;
  background: none;
  border: 0;
  border-radius: 3px;
  padding: 6px 10px;
  cursor: pointer;
  white-space: nowrap;
}

.menu-items button:hover {
  background: #333;
}

.menu-items button.on::before {
  content: "✓ ";
}

.menu-items button:not(.on)::before {
  content: "";
  display: inline-block;
  width: 1.1em;
}

.menu-items hr {
  border: 0;
  border-top: 1px solid #3a3a3a;
  margin: 4px 0;
}

.menu-items.help {
  min-width: 300px;
  max-width: 360px;
  padding: 8px 12px;
  color: #bbb;
  line-height: 1.4;
}

.menu-items.help p {
  margin: 4px 0;
}

kbd {
  font: 11px/1 ui-monospace, Menlo, monospace;
  padding: 1px 4px;
  border: 1px solid #555;
  border-bottom-width: 2px;
  border-radius: 3px;
  background: #1a1a1a;
}

.status {
  margin-left: auto;
  display: flex;
  gap: 8px;
  color: #aaa;
}

.status .dim {
  color: #777;
}
</style>
