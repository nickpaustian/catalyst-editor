<view>
<aside class="panel">
  <SelectionFields />

  <div id="recipe-sections"></div>
</aside>
</view>

<logic lang="ts">
// The inspector: what is selected, and a recipe's own sections, mounted into
// #recipe-sections by the app. The scene tree (ScenePane) and the project's
// settings (EnvironmentPane) are panes of their own.
export {}
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
</style>
