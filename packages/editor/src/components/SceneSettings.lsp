<view>
<section class="settings" $if="shared['editor:settings']">
  <h2 class="heading">{{ shared['editor:settings'].title }}</h2>
  <div class="row" $for="field in state.fields" $key="field.key">
    <label class="label">{{ field.label }}</label>
    <input $if="field.type === 'number'" type="number" $step="field.step" $min="field.min" $max="field.max" $model="field.value" @change="apply(field)" />
    <input $else-if="field.type === 'boolean'" type="checkbox" $model="field.value" @change="apply(field)" />
    <input $else type="text" $model="field.value" @change="apply(field)" />
  </div>
</section>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

interface Field { key: string; label: string; type: string; value: unknown; min?: number; max?: number; step?: number }

const settings = shared('editor:settings', null)
const state = reactive({ fields: [] as Field[] })

settings.subscribe((next: any) => {
  state.fields = (next?.fields ?? []).map((field: Field) => ({ ...field }))
})

function apply(field: Field) {
  sendCommand({ type: 'setSetting', key: field.key, value: field.value })
}
</logic>

<style>
.heading {
  font-size: var(--cat-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cat-text-secondary);
  margin: var(--cat-space-3) 0 var(--cat-space-1);
}

.row {
  display: flex;
  align-items: center;
  margin: var(--cat-space-0-5) 0;
}

.label {
  width: 90px;
  color: var(--cat-text-secondary);
}

input {
  font: inherit;
  color: inherit;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-0-5) var(--cat-space-1-5);
}

input[type="number"] {
  width: 64px;
  font-family: var(--cat-font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
