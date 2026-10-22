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
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #999;
  margin: 14px 0 4px;
}

.row {
  display: flex;
  align-items: center;
  margin: 2px 0;
}

.label {
  width: 90px;
  color: #999;
}

input {
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 6px;
}

input[type="number"] {
  width: 64px;
}
</style>
