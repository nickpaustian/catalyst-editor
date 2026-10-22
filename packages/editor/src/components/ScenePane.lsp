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
  padding: 12px;
  background: #101010;
  color: #eee;
  font: 12px/1.4 "IBM Plex Sans", system-ui, sans-serif;
}
</style>
