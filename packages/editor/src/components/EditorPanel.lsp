<view>
<aside class="panel">
  <h2>Selected</h2>
  <SelectionFields />

  <SceneSettings />

  <div id="recipe-sections"></div>
</aside>
</view>

<logic lang="ts">
// The inspector: what is selected, the project's settings, and a recipe's own
// sections, mounted into #recipe-sections by the app. The scene tree is its
// own pane (ScenePane).
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

h2 {
  font-size: var(--cat-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cat-text-secondary);
  margin: var(--cat-space-3) 0 var(--cat-space-1);
}

.hint {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
  margin: var(--cat-space-1) 0;
}
</style>
