<view>
<aside class="panel">
  <SceneTree />

  <h2>Selected</h2>
  <SelectionFields />

  <SceneSettings />

  <div id="recipe-sections"></div>
</aside>
<AddNodeDialog />
</view>

<logic lang="ts">
// The shell only arranges the sections; each reads its own cells. A recipe's
// sections are mounted into #recipe-sections by the app.
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

h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #999;
  margin: 14px 0 4px;
}

.hint {
  color: #888;
  font-size: 11px;
  margin: 4px 0;
}
</style>
