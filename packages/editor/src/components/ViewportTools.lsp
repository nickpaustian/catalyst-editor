<view>
<div class="tools" role="toolbar" aria-label="Transform tools" $if="shared['editor:project'].open">
  <button class="icon-button tool" type="button" title="Move (W)" aria-label="Move (W)" $aria-pressed="shared['editor:view'].gizmo === 'translate'" @click="setGizmo('translate')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5v13M1.5 8h13M6 3.5l2-2 2 2M6 12.5l2 2 2-2M3.5 6l-2 2 2 2M12.5 6l2 2-2 2"/></svg>
  </button>
  <button class="icon-button tool" type="button" title="Rotate (E)" aria-label="Rotate (E)" $aria-pressed="shared['editor:view'].gizmo === 'rotate'" @click="setGizmo('rotate')">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1"/><path d="M12.5 1.5v3h-3"/></svg>
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
</style>
