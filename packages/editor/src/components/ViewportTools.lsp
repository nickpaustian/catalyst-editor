<view>
<div class="tools" role="toolbar" aria-label="Transform tools" $if="shared['editor:project'].open">
  <button class="icon-button tool" type="button" title="Move (W)" aria-label="Move (W)" $aria-pressed="shared['editor:view'].gizmo === 'translate' && !shared['editor:view'].tool && !shared['editor:grid']?.painting" @click="setGizmo('translate')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2"/></svg>
  </button>
  <button class="icon-button tool" type="button" title="Rotate (E)" aria-label="Rotate (E)" $aria-pressed="shared['editor:view'].gizmo === 'rotate' && !shared['editor:view'].tool && !shared['editor:grid']?.painting" @click="setGizmo('rotate')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1"/><path d="M12.5 1.5v3h-3"/></svg>
  </button>
  <button class="icon-button tool" type="button" title="Scale (R)" aria-label="Scale (R)" $aria-pressed="shared['editor:view'].gizmo === 'scale' && !shared['editor:view'].tool && !shared['editor:grid']?.painting" @click="setGizmo('scale')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 13.5 9 7"/><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5 9 7"/><rect x="2.5" y="8.5" width="5" height="5"/></svg>
  </button>
  <button class="icon-button tool" type="button" title="Vertices (Tab): move the vertices of an editable mesh" aria-label="Vertices (Tab)" $aria-pressed="shared['editor:view'].vertexEdit" @click="setVertexEdit(!shared['editor:view'].vertexEdit)">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12 6 4l4 4 3-3-1.5 7z"/><circle cx="6" cy="4" r="1.4" fill="currentColor"/><circle cx="10" cy="8" r="1.4" fill="currentColor"/><circle cx="3" cy="12" r="1.4" fill="currentColor"/></svg>
  </button>
  <template $if="shared['editor:view'].vertexEdit">
    <span class="divider"></span>
    <div class="segmented modes" role="radiogroup" aria-label="What the vertex tool picks">
      <button type="button" role="radio" title="Vertices (1)" $aria-checked="shared['editor:view'].editMode === 'vertex'" @click="setEditMode('vertex')">vert</button>
      <button type="button" role="radio" title="Edges (2)" $aria-checked="shared['editor:view'].editMode === 'edge'" @click="setEditMode('edge')">edge</button>
      <button type="button" role="radio" title="Faces (3): X extrudes, ⌦ deletes" $aria-checked="shared['editor:view'].editMode === 'face'" @click="setEditMode('face')">face</button>
    </div>
  </template>
  <span class="divider"></span>
  <button class="icon-button tool" type="button" title="Draw box (B): drag a footprint on the ground, then set the height" aria-label="Draw box (B)" $aria-pressed="shared['editor:view'].tool === 'box'" @click="setTool('box')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8 14 4.9v6.2L8 14.2 2 11.1V4.9z"/><path d="M2 4.9 8 8l6-3.1M8 8v6.2"/><path d="M11 13.5l1.5 1.5 2-2.5"/></svg>
  </button>
  <button class="icon-button tool" type="button" title="Draw collider (V): a collision volume only, for blocking out a splat scene" aria-label="Draw collider (V)" $aria-pressed="shared['editor:view'].tool === 'collider'" @click="setTool('collider')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 1.5" aria-hidden="true"><path d="M8 1.8 14 4.9v6.2L8 14.2 2 11.1V4.9z"/><path d="M2 4.9 8 8l6-3.1M8 8v6.2"/></svg>
  </button>
  <template $if="shared['editor:grid']">
    <span class="divider"></span>
    <button class="icon-button tool" type="button" title="Paint tiles (P): drag over the grid to lay the tile type chosen in the inspector; option-drag still orbits" aria-label="Paint tiles (P)" $aria-pressed="shared['editor:grid'].painting" @click="paint()">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 1.8l3.7 3.7-6 6-3.7-3.7z"/><path d="M4.5 7.3 2 9.8c-.8.8-.8 2 0 2.8l1.4 1.4c.8.8 2 .8 2.8 0l2.5-2.5"/></svg>
    </button>
    <div class="segmented modes" role="radiogroup" aria-label="How the paint tool lays tiles" $if="shared['editor:grid'].painting">
      <button type="button" role="radio" title="Brush: each cell the drag passes over" $aria-checked="shared['editor:grid'].mode === 'brush'" @click="paintMode('brush')">brush</button>
      <button type="button" role="radio" title="Fill: the run of like cells joined to the one clicked" $aria-checked="shared['editor:grid'].mode === 'fill'" @click="paintMode('fill')">fill</button>
    </div>
  </template>
  <span class="divider"></span>
  <div class="segmented modes" role="radiogroup" aria-label="Which engine draws the viewport">
    <button type="button" role="radio" title="The TypeScript engine draws the viewport" $aria-checked="shared['editor:view'].engine === 'ts'" @click="setEngine('ts')">ts</button>
    <button type="button" role="radio" title="The Rust engine (wasm) draws the viewport: the scene mirrored, the gizmo still the TypeScript engine's" $aria-checked="shared['editor:view'].engine === 'rust'" @click="setEngine('rust')">rust</button>
  </div>
  <template $if="shared['editor:selection']?.onSlate || shared['editor:view'].slateEditing">
    <span class="divider"></span>
    <button class="icon-button tool" type="button" title="Edit slate: the slate on its own, to place its UI (Esc returns)" aria-label="Edit slate" $aria-pressed="shared['editor:view'].slateEditing" @click="editSlate(!shared['editor:view'].slateEditing)">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1.5"/><rect x="5" y="6" width="4" height="4"/><path d="M11 6.5v3"/></svg>
    </button>
  </template>
</div>
</view>

<logic lang="ts">
// The transform tools, floating over the viewport's top-left corner
import { shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { PROJECT_DEFAULT, VIEW_DEFAULT } from '../cells.ts'

shared('editor:project', PROJECT_DEFAULT)
shared('editor:view', VIEW_DEFAULT)
shared('editor:selection', null)
shared('editor:grid', null)

function paint() {
  sendCommand({ type: 'gridPaint' })
}

function paintMode(mode: string) {
  sendCommand({ type: 'gridMode', mode })
}

function setEngine(engine: string) {
  sendCommand({ type: 'setViewportEngine', engine })
}

function setGizmo(mode: string) {
  sendCommand({ type: 'setGizmo', mode })
}

function setTool(tool: string) {
  sendCommand({ type: 'setTool', tool })
}

function setVertexEdit(on: boolean) {
  sendCommand({ type: 'setVertexEdit', on })
}

function editSlate(on: boolean) {
  sendCommand({ type: 'editSlate', on })
}

function setEditMode(mode: string) {
  sendCommand({ type: 'setEditMode', mode })
}
</logic>

<style>
.tools {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 5;
  display: flex;
  gap: var(--cat-space-0-5);
  padding: var(--cat-space-0-5);
  background: var(--cat-viewport-chrome);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-md);
  box-shadow: var(--cat-shadow-e1);
}

.tool {
  width: 26px;
  height: 26px;
}

.modes {
  align-self: center;
  font-size: var(--cat-text-xs);
}

.divider {
  width: 1px;
  margin: 3px 2px;
  background: var(--cat-border);
}
</style>
