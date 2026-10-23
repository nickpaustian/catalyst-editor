<view>
<header class="bar" data-tauri-drag-region>
  <span class="brand">Catalyst</span>

  <nav class="menus" data-tauri-drag-region>
    <div class="menu" $class="{ open: state.open === 'file' }">
      <button class="menu-title" @click="toggle('file')" @pointerenter="hover('file')">File</button>
      <div class="menu-items menu-panel" role="menu" $if="state.open === 'file'">
        <button class="menu-item" role="menuitem" @click="run('newProject')">New project <span class="dim" $if="shared['editor:project'].browserStorage">in the browser</span></button>
        <button class="menu-item" role="menuitem" @click="run('openFolder')" $disabled="!shared['editor:project'].supported">Open folder…</button>
        <button class="menu-item" role="menuitem" @click="run('reopenLast')" $disabled="!shared['editor:project'].supported">Reopen last</button>
        <button class="menu-item" role="menuitem" @click="run('reloadProject')" $disabled="!shared['editor:project'].open">Reload from disk</button>
        <button class="menu-item" role="menuitem" @click="run('closeProject')" $disabled="!shared['editor:project'].open">Close project</button>
        <hr />
        <button class="menu-item" role="menuitem" @click="projectSettings()" $disabled="!shared['editor:project'].open">Project settings…</button>
        <hr />
        <button class="menu-item" role="menuitem" @click="run('saveAll')">Save <span class="dim">scene and open script</span> <kbd>⌘S</kbd></button>
        <button class="menu-item" role="menuitem" @click="run('saveAs')">Save as…</button>
        <hr />
        <button class="menu-item" role="menuitem" @click="run('download')">Download scene file</button>
        <hr />
        <button class="menu-item" role="menuitem" @click="run('run')">Run <kbd>⌘R</kbd></button>
      </div>
    </div>

    <div class="menu" $class="{ open: state.open === 'edit' }">
      <button class="menu-title" @click="toggle('edit')" @pointerenter="hover('edit')">Edit</button>
      <div class="menu-items menu-panel" role="menu" $if="state.open === 'edit'">
        <button class="menu-item" role="menuitem" $disabled="!shared['editor:history'].canUndo" @click="run('undo')">Undo{{ shared['editor:history'].undoLabel ? ' ' + shared['editor:history'].undoLabel : '' }} <kbd>⌘Z</kbd></button>
        <button class="menu-item" role="menuitem" $disabled="!shared['editor:history'].canRedo" @click="run('redo')">Redo{{ shared['editor:history'].redoLabel ? ' ' + shared['editor:history'].redoLabel : '' }} <kbd>⌘⇧Z</kbd></button>
        <hr />
        <button class="menu-item" role="menuitem" @click="run('duplicate')">Duplicate <kbd>⌘D</kbd></button>
        <button class="menu-item" role="menuitem" @click="run('delete')">Delete selected <kbd>⌦</kbd></button>
        <button class="menu-item" role="menuitem" @click="run('unparent')">Unparent <span class="dim">move the selection up beside its parent</span></button>
        <hr />
        <button class="menu-item" role="menuitem" $disabled="!shared['editor:selection'] || shared['editor:selection'].count !== 1 || shared['editor:selection'].prefab !== null" @click="run('makePrefab')">Make prefab <span class="dim">save the selected node as a reusable file</span></button>
        <button class="menu-item" role="menuitem" $disabled="!shared['editor:selection'] || shared['editor:selection'].count !== 1 || shared['editor:selection'].prefab === null" @click="run('unpackPrefab')">Unpack prefab <span class="dim">make the copy editable</span></button>
      </div>
    </div>

    <div class="menu" $class="{ open: state.open === 'view' }">
      <button class="menu-title" @click="toggle('view')" @pointerenter="hover('view')">View</button>
      <div class="menu-items menu-panel" role="menu" $if="state.open === 'view'">
        <button class="menu-item" role="menuitemcheckbox" $class="{ on: shared['editor:view'].visualised }" $aria-checked="shared['editor:view'].visualised" @click="run('toggleVisualisers')">Visualisers</button>
        <button class="menu-item" role="menuitemcheckbox" $class="{ on: shared['editor:view'].physics }" $aria-checked="shared['editor:view'].physics" @click="run('togglePhysics')">Physics running</button>
        <button class="menu-item" role="menuitemcheckbox" $class="{ on: shared['editor:view'].scripts }" $aria-checked="shared['editor:view'].scripts" @click="run('toggleScripts')">Scripts running</button>
        <hr />
        <button class="menu-item" role="menuitemcheckbox" $class="{ on: shared['editor:view'].gizmo === 'translate' }" $aria-checked="shared['editor:view'].gizmo === 'translate'" @click="setGizmo('translate')">Gizmo: translate</button>
        <button class="menu-item" role="menuitemcheckbox" $class="{ on: shared['editor:view'].gizmo === 'rotate' }" $aria-checked="shared['editor:view'].gizmo === 'rotate'" @click="setGizmo('rotate')">Gizmo: rotate</button>
        <hr />
        <button class="menu-item" role="menuitemcheckbox" $class="{ on: shared['editor:view'].snap.enabled }" $aria-checked="shared['editor:view'].snap.enabled" @click="setSnap({ enabled: !shared['editor:view'].snap.enabled })">Snap <span class="dim">hold ⇧ for the opposite</span></button>
        <div class="choices">
          <span class="dim" id="snap-move">move</span>
          <div class="segmented" role="radiogroup" aria-labelledby="snap-move">
            <button type="button" role="radio" class="mono" $for="step in state.moveSteps" $key="step" $aria-checked="shared['editor:view'].snap.move === step" @click="setSnap({ move: step })">{{ step }}</button>
          </div>
        </div>
        <div class="choices">
          <span class="dim" id="snap-turn">turn</span>
          <div class="segmented" role="radiogroup" aria-labelledby="snap-turn">
            <button type="button" role="radio" class="mono" $for="step in state.rotateSteps" $key="step" $aria-checked="shared['editor:view'].snap.rotate === step" @click="setSnap({ rotate: step })">{{ step }}°</button>
          </div>
        </div>
        <hr />
        <button class="menu-item" role="menuitem" @click="resetLayout()">Reset pane layout</button>
      </div>
    </div>

    <div class="menu" $class="{ open: state.open === 'help' }">
      <button class="menu-title" @click="toggle('help')" @pointerenter="hover('help')">Help</button>
      <div class="menu-items menu-panel help" $if="state.open === 'help'">
        <p><b>Orbit:</b> drag to orbit, right-drag to pan, wheel to zoom. <kbd>F</kbd> focuses the selected node, <kbd>Delete</kbd> removes it. Drag the gizmo to move it.</p>
        <p><b>Viewport:</b> shift-drag a rectangle to select what it covers; hold <kbd>⌘</kbd> or <kbd>Ctrl</kbd> as well to add to the selection.</p>
        <p><b>Tree:</b> new nodes go under the selected node. Shift-click selects a range, ctrl- or cmd-click adds or removes one. Drag a row onto another: its top third puts it before, its bottom third after, the middle makes it a child. World position is kept.</p>
        <p><b>Panes:</b> drag a gutter to resize, a pane title to move it; its <b>…</b> menu adds a pane beside it or closes it.</p>
      </div>
    </div>
  </nav>

  <button class="button small run" title="Run (⌘R / Ctrl+R)" @click="run('run')">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.5v9l7-4.5z" fill="currentColor"/></svg>
    Run
  </button>

  <span class="status">
    <span>{{ shared['editor:project'].open ? (shared['editor:project'].name ?? 'untitled') : '' }}</span>
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
import { HISTORY_DEFAULT, PROJECT_DEFAULT, VIEW_DEFAULT } from '../cells.ts'

shared('editor:project', PROJECT_DEFAULT)
shared('editor:view', VIEW_DEFAULT)
shared('editor:history', HISTORY_DEFAULT)
shared('editor:selection', null)

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

function projectSettings() {
  state.open = null
  sendCommand({ type: 'openProjectDialog', mode: 'edit' })
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
  height: var(--menu-bar-height);
  display: flex;
  align-items: center;
  gap: var(--cat-space-2);
  padding: 0 var(--cat-space-2);
  box-sizing: border-box;
  background: var(--cat-bg-app);
  border-bottom: 1px solid var(--cat-border);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / 1 var(--cat-font-ui);
  z-index: 1100;
  user-select: none;
}

.brand {
  font-weight: 600;
  letter-spacing: 0.04em;
}

.run svg {
  width: var(--cat-icon-xs);
  height: var(--cat-icon-xs);
  color: var(--cat-success);
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
  padding: 0 var(--cat-space-2);
  cursor: default;
}

.menu-title:hover,
.menu.open .menu-title {
  background: var(--cat-bg-hover);
}

.menu-items {
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 190px;
  border-radius: 0 0 var(--cat-radius-md) var(--cat-radius-md);
}

.menu-items > button::before {
  content: "";
  flex: 0 0 var(--cat-icon-xs);
  height: var(--cat-icon-xs);
}

.menu-items > button.on::before {
  background: currentColor;
  mask: var(--glyph-check) center / contain no-repeat;
}

.choices {
  display: flex;
  align-items: center;
  gap: var(--cat-space-2);
  padding: var(--cat-space-0-5) var(--cat-space-2) var(--cat-space-1) calc(var(--cat-space-2) + var(--cat-icon-xs) + var(--cat-space-1-5));
}

.choices .dim {
  flex: 0 0 auto;
  width: var(--cat-space-8);
}

.choices .segmented {
  grid-auto-columns: minmax(max-content, 1fr);
}

.menu-items .dim {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.menu-items.help {
  min-width: 300px;
  max-width: 360px;
  padding: var(--cat-space-2) var(--cat-space-3);
  color: var(--cat-text-secondary);
  line-height: var(--cat-leading-body);
}

.menu-items.help p {
  margin: var(--cat-space-1) 0;
}

.status {
  margin-left: auto;
  display: flex;
  gap: var(--cat-space-2);
  color: var(--cat-text-secondary);
}

.status .dim {
  color: var(--cat-text-tertiary);
}
</style>
