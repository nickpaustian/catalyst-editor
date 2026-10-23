<view>
<section class="settings" $if="shared['editor:settings']">
  <h2 class="section-label">{{ shared['editor:settings'].title }}</h2>
  <div class="properties">
    <template $for="field in state.fields" $key="field.key">
      <label class="label" $class="{ scrub: field.type === 'number' }" $title="field.label" @pointerdown="scrubField($event, field)">{{ field.label }}</label>
      <div class="control">
        <div class="well" $if="field.type === 'number'">
          <span class="fill" $if="field.ranged" $style="'width: ' + Math.min(100, Math.max(0, (field.value - field.min) / (field.max - field.min) * 100)) + '%'"></span>
          <input type="number" $aria-label="field.label" $step="field.step" $min="field.min" $max="field.max" $model="field.value" @change="apply(field)" />
        </div>
        <input $else-if="field.type === 'boolean'" class="checkbox" type="checkbox" $aria-label="field.label" $model="field.value" @change="apply(field)" />
        <input $else class="well" type="text" $aria-label="field.label" $model="field.value" @change="apply(field)" />
      </div>
    </template>
  </div>
</section>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { scrub } from '../scrub.ts'

interface Field { key: string; label: string; type: string; value: unknown; min?: number; max?: number; step?: number; ranged?: boolean }

const settings = shared('editor:settings', null)
const state = reactive({ fields: [] as Field[] })

settings.subscribe((next: any) => {
  state.fields = (next?.fields ?? []).map((field: Field) => ({ ...field, ranged: field.type === 'number' && field.min !== undefined && field.max !== undefined }))
})

function apply(field: Field) {
  sendCommand({ type: 'setSetting', key: field.key, value: field.value })
}

function scrubField(event: PointerEvent, field: Field) {
  if (field.type !== 'number') return
  scrub(event, {
    read: () => Number(field.value),
    write: (value) => {
      field.value = value
      apply(field)
    },
    step: field.step ?? 0.01,
    min: field.min,
    max: field.max,
    input: (event.currentTarget as HTMLElement).nextElementSibling?.querySelector('input'),
  })
}
</logic>

<style>
.settings {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-2);
  margin-top: var(--cat-space-4);
}

.control > .well {
  flex: 1 1 auto;
}
</style>
