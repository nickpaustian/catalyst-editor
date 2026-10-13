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
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #999;
  margin: 14px 0 4px;
}

.field {
  display: flex;
  flex-direction: column;
  margin: 4px 0;
}

label {
  color: #999;
  font-size: 11px;
}

input,
textarea {
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 6px;
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
}

.hint {
  color: #888;
  font-size: 11px;
  margin: 4px 0;
}
</style>
