<view>
<aside class="panel">
  <SceneTree />
</aside>
<AddNodeDialog />
</view>

<logic lang="ts">
// The scene pane: the tree and the dialog that adds to it
export {}
</logic>

<style>
.panel {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  padding: var(--cat-space-3);
  background: var(--cat-bg-panel);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / var(--cat-leading-body) var(--cat-font-ui);
}
</style>
