<view>
<div class="tools" role="toolbar" aria-label="Transform tools" $if="shared['editor:project'].open">
  <button class="icon-button tool" type="button" title="Move (W)" aria-label="Move (W)" $aria-pressed="shared['editor:view'].gizmo === 'translate' && !shared['editor:view'].tool" @click="setGizmo('translate')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2"/></svg>
  </button>
  <button class="icon-button tool" type="button" title="Rotate (E)" aria-label="Rotate (E)" $aria-pressed="shared['editor:view'].gizmo === 'rotate' && !shared['editor:view'].tool" @click="setGizmo('rotate')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1"/><path d="M12.5 1.5v3h-3"/></svg>
  </button>
  <button class="icon-button tool" type="button" title="Scale (R)" aria-label="Scale (R)" $aria-pressed="shared['editor:view'].gizmo === 'scale' && !shared['editor:view'].tool" @click="setGizmo('scale')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 13.5 9 7"/><path d="M9.5 2.5h4v4"/><path d="M13.5 2.5 9 7"/><rect x="2.5" y="8.5" width="5" height="5"/></svg>
  </button>
  <button class="icon-button tool" type="button" title="Vertices (Tab): move the vertices of an editable mesh" aria-label="Vertices (Tab)" $aria-pressed="shared['editor:view'].vertexEdit" @click="setVertexEdit(!shared['editor:view'].vertexEdit)">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12 6 4l4 4 3-3-1.5 7z"/><circle cx="6" cy="4" r="1.4" fill="currentColor"/><circle cx="10" cy="8" r="1.4" fill="currentColor"/><circle cx="3" cy="12" r="1.4" fill="currentColor"/></svg>
  </button>
  <span class="divider"></span>
  <button class="icon-button tool" type="button" title="Draw box (B): drag a footprint on the ground, then set the height" aria-label="Draw box (B)" $aria-pressed="shared['editor:view'].tool === 'box'" @click="setTool('box')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.8 14 4.9v6.2L8 14.2 2 11.1V4.9z"/><path d="M2 4.9 8 8l6-3.1M8 8v6.2"/><path d="M11 13.5l1.5 1.5 2-2.5"/></svg>
  </button>
  <button class="icon-button tool" type="button" title="Draw collider (V): a collision volume only, for blocking out a splat scene" aria-label="Draw collider (V)" $aria-pressed="shared['editor:view'].tool === 'collider'" @click="setTool('collider')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 1.5" aria-hidden="true"><path d="M8 1.8 14 4.9v6.2L8 14.2 2 11.1V4.9z"/><path d="M2 4.9 8 8l6-3.1M8 8v6.2"/></svg>
  </button>
</div>
</view>

<logic lang="ts">
// The transform tools, floating over the viewport's top-left corner
import { shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { PROJECT_DEFAULT, VIEW_DEFAULT } from '../cells.ts'

shared('editor:project', PROJECT_DEFAULT)
shared('editor:view', VIEW_DEFAULT)

function setGizmo(mode: string) {
  sendCommand({ type: 'setGizmo', mode })
}

function setTool(tool: string) {
  sendCommand({ type: 'setTool', tool })
}

function setVertexEdit(on: boolean) {
  sendCommand({ type: 'setVertexEdit', on })
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

.divider {
  width: 1px;
  margin: 3px 2px;
  background: var(--cat-border);
}
</style>
