<view>
<header class="bar">
  <span class="brand">Catalyst</span>

  <nav class="menus">
    <div class="menu" $class="{ open: state.open === 'file' }">
      <button class="menu-title" @click="toggle('file')" @pointerenter="hover('file')">File</button>
      <div class="menu-items" $if="state.open === 'file'">
        <button @click="run('newProject')">New project <span class="dim">in the browser</span></button>
        <button @click="run('openFolder')" $disabled="!shared['editor:project'].supported">Open folder…</button>
        <button @click="run('reopenLast')" $disabled="!shared['editor:project'].supported">Reopen last</button>
        <hr />
        <button @click="run('save')">Save</button>
        <button @click="run('saveAs')">Save as…</button>
        <hr />
        <button @click="run('download')">Download scene file</button>
        <hr />
        <button @click="run('run')">Run <kbd>⌘R</kbd></button>
      </div>
    </div>

    <div class="menu" $class="{ open: state.open === 'edit' }">
      <button class="menu-title" @click="toggle('edit')" @pointerenter="hover('edit')">Edit</button>
      <div class="menu-items" $if="state.open === 'edit'">
        <button $disabled="!shared['editor:history'].canUndo" @click="run('undo')">Undo{{ shared['editor:history'].undoLabel ? ' ' + shared['editor:history'].undoLabel : '' }} <kbd>⌘Z</kbd></button>
        <button $disabled="!shared['editor:history'].canRedo" @click="run('redo')">Redo{{ shared['editor:history'].redoLabel ? ' ' + shared['editor:history'].redoLabel : '' }} <kbd>⌘⇧Z</kbd></button>
        <hr />
        <button @click="run('delete')">Delete selected <kbd>⌦</kbd></button>
      </div>
    </div>

    <div class="menu" $class="{ open: state.open === 'view' }">
      <button class="menu-title" @click="toggle('view')" @pointerenter="hover('view')">View</button>
      <div class="menu-items" $if="state.open === 'view'">
        <button $class="{ on: shared['editor:view'].visualised }" @click="run('toggleVisualisers')">Visualisers</button>
        <button $class="{ on: shared['editor:view'].physics }" @click="run('togglePhysics')">Physics running</button>
        <hr />
        <button $class="{ on: shared['editor:view'].gizmo === 'translate' }" @click="setGizmo('translate')">Gizmo: translate</button>
        <button $class="{ on: shared['editor:view'].gizmo === 'rotate' }" @click="setGizmo('rotate')">Gizmo: rotate</button>
        <hr />
        <button $class="{ on: shared['editor:view'].snap.enabled }" @click="setSnap({ enabled: !shared['editor:view'].snap.enabled })">Snap <span class="dim">hold ⇧ for the opposite</span></button>
        <div class="choices">
          <span class="dim">move</span>
          <button $for="step in state.moveSteps" $key="step" $class="{ on: shared['editor:view'].snap.move === step }" @click="setSnap({ move: step })">{{ step }}</button>
        </div>
        <div class="choices">
          <span class="dim">turn</span>
          <button $for="step in state.rotateSteps" $key="step" $class="{ on: shared['editor:view'].snap.rotate === step }" @click="setSnap({ rotate: step })">{{ step }}°</button>
        </div>
        <hr />
        <button @click="resetLayout()">Reset pane layout</button>
      </div>
    </div>

    <div class="menu" $class="{ open: state.open === 'help' }">
      <button class="menu-title" @click="toggle('help')" @pointerenter="hover('help')">Help</button>
      <div class="menu-items help" $if="state.open === 'help'">
        <p><b>Orbit:</b> drag to orbit, right-drag to pan, wheel to zoom. <kbd>F</kbd> focuses the selected node, <kbd>Delete</kbd> removes it. Drag the gizmo to move it.</p>
        <p><b>Tree:</b> shift-click selects a range, ctrl- or cmd-click adds or removes one. Drag a row onto another to reparent it.</p>
        <p><b>Panes:</b> drag a gutter to resize, a pane title to move it; <b>+</b> adds a pane, <b>×</b> closes one.</p>
      </div>
    </div>
  </nav>

  <button class="run" title="Run (⌘R / Ctrl+R)" @click="run('run')">▶ Run</button>

  <span class="status">
    <span>{{ shared['editor:project'].name ?? 'untitled' }}</span>
    <span class="dim">{{ shared['editor:project'].storage === 'browser' ? 'in browser' : shared['editor:project'].storage === 'disk' ? 'on disk' : '' }}</span>
    <span class="dim">{{ shared['editor:project'].recipe }}</span>
    <span class="dim" $if="shared['editor:project'].status">{{ shared['editor:project'].status }}</span>
    <span class="dim" $if="shared['editor:project'].dirty && !shared['editor:project'].status">unsaved changes</span>
  </span>
</header>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { preferences } from '../preferences.ts'

shared('editor:project', { name: null, recipe: '', storage: null, status: '', supported: false, dirty: false })
shared('editor:view', { view: 'orbit', visualised: true, gizmo: 'translate', physics: false, snap: { enabled: true, move: 0.25, rotate: 15 } })
shared('editor:history', { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null })

const state = reactive({ open: null as string | null, moveSteps: [0.05, 0.1, 0.25, 0.5, 1], rotateSteps: [5, 15, 45, 90] })

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

function setGizmo(mode: string) {
  state.open = null
  sendCommand({ type: 'setGizmo', mode })
}

function setSnap(snap: Record<string, unknown>) {
  sendCommand({ type: 'setSnap', snap })
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

.run {
  font: inherit;
  color: #dfe8ff;
  background: #2a3650;
  border: 1px solid #6a8fd8;
  border-radius: 3px;
  padding: 3px 10px;
  cursor: pointer;
}

.run:hover {
  background: #3b5aa0;
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

.menu-items button:disabled {
  color: #666;
  cursor: default;
  background: none;
}

.menu-items button.on::before {
  content: "✓ ";
}

.menu-items button:not(.on)::before {
  content: "";
  display: inline-block;
  width: 1.1em;
}

.choices {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 10px 4px 26px;
}

.choices .dim {
  color: #777;
  width: 34px;
}

.choices button {
  padding: 2px 6px;
  color: #aaa;
  border: 1px solid #3a3a3a;
}

.choices button.on {
  color: #fff;
  background: #3b5aa0;
  border-color: #6a8fd8;
}

.choices button::before,
.choices button:not(.on)::before {
  content: none;
  width: 0;
}

.menu-items .dim {
  color: #777;
  font-size: 11px;
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
