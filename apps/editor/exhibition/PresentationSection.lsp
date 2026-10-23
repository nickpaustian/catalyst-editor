<view>
<section class="presentation">
  <h2>Presentation</h2>
  <div class="field" $for="field in state.fields" $key="field.path">
    <label>{{ field.label }}</label>
    <textarea $if="field.multiline" rows="3" $model="field.value" @change="apply(field)"></textarea>
    <input $else type="text" $model="field.value" @change="apply(field)" />
  </div>
  <p class="hint">Applied to the live landing card, HUD and footer; saved with the manifest.</p>
</section>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

const published = shared('editor:presentation', [])

// Local copies of the fields, so typing doesn't fight the session publishing
// the same values back, and a new exhibition's values replace stale ones
const state = reactive({ fields: [] as { path: string; label: string; value: string; multiline: boolean }[] })

published.subscribe((next: any) => {
  state.fields = (next ?? []).map((field: any) => ({ ...field }))
})

function apply(field: { path: string; value: string }) {
  sendCommand({ type: 'setPresentation', path: field.path, value: field.value })
}
</logic>

<style>
h2 {
  font-size: var(--cat-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cat-text-secondary);
  margin: var(--cat-space-3) 0 var(--cat-space-1);
}

.field {
  display: flex;
  flex-direction: column;
  margin: var(--cat-space-1) 0;
}

label {
  color: var(--cat-text-secondary);
  font-size: var(--cat-text-xs);
}

input,
textarea {
  font: inherit;
  color: inherit;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-0-5) var(--cat-space-1-5);
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
}

.hint {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
  margin: var(--cat-space-1) 0;
}
</style>
