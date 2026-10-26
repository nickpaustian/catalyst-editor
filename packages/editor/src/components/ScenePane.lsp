<view>
<aside class="panel">
  <div class="editing" $if="shared['editor:sceneFile']">
    <span class="what">Editing <span class="mono">{{ shared['editor:sceneFile'] }}</span></span>
    <button class="button small" type="button" title="Edit the project's own scene again" @click="back()">Back to the scene</button>
  </div>
  <SceneTree />
</aside>
<AddNodeDialog />
</view>

<logic lang="ts">
// The scene pane: the tree and the dialog that adds to it, and which file the tree is when it isn't the project's scene
import { shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

shared('editor:sceneFile', null)

function back() {
  sendCommand({ type: 'openScene', path: null })
}
</logic>

<style>
.panel {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  background: var(--cat-bg-panel);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / var(--cat-leading-body) var(--cat-font-ui);
}

.editing {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--cat-space-2);
  padding: var(--cat-space-1-5) var(--cat-space-2);
  border-bottom: 1px solid var(--cat-border-subtle);
  background: var(--cat-bg-raised);
  color: var(--cat-text-secondary);
  font: var(--cat-text-xs) / var(--cat-leading-tight) var(--cat-font-ui);
}

.editing .what {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: var(--cat-font-mono);
  color: var(--cat-text-primary);
}
</style>
