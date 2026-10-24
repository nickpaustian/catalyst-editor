<view>
<section class="section" $if="shared['editor:settings']">
  <button class="section-header" type="button" $aria-expanded="state.open" @click="state.open = !state.open"><span class="title">{{ shared['editor:settings'].title }}</span></button>
  <div class="section-body" $if="state.open">
    <div class="properties">
      <template $for="field in state.fields" $key="field.key">
        <label class="label" $class="{ scrub: field.type === 'number' }" $title="field.label" @pointerdown="scrubField($event, field)">{{ field.label }}</label>
        <div class="control">
          <div class="well" $if="field.type === 'number'">
            <span class="fill" $if="field.ranged" $style="'width: ' + Math.min(100, Math.max(0, (field.value - field.min) / (field.max - field.min) * 100)) + '%'"></span>
            <input type="number" $aria-label="field.label" $step="field.step" $min="field.min" $max="field.max" $model="field.value" @change="apply(field)" />
          </div>
          <input $else-if="field.type === 'boolean'" class="checkbox" type="checkbox" $aria-label="field.label" $model="field.value" @change="apply(field)" />
          <label class="well colour" $else-if="field.type === 'colour'">
            <input class="swatch" type="color" $aria-label="field.label" $model="field.hex" @input="applyColour($event, field)" />
            <span class="mono">{{ field.hex }}</span>
          </label>
          <select $else-if="field.type === 'select'" class="well" $aria-label="field.label" @change="applySelect($event, field)">
            <template $for="choice in field.options" $key="choice">
              <option $value="choice" $selected="choice === field.value">{{ choice }}</option>
            </template>
          </select>
          <div class="well file" $else-if="field.type === 'file'">
            <span class="name" $title="field.value || ''">{{ field.value || 'none' }}</span>
            <button class="small" type="button" $if="field.value" aria-label="Clear" @click="clearFile(field)">×</button>
            <button class="small" type="button" @click="pickFile(field)">Choose…</button>
          </div>
          <input $else class="well" type="text" $aria-label="field.label" $model="field.value" @change="apply(field)" />
        </div>
      </template>
    </div>
  </div>
</section>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { scrub } from '../scrub.ts'

interface Field { key: string; label: string; type: string; value: unknown; min?: number; max?: number; step?: number; options?: string[]; accept?: string; ranged?: boolean; hex?: string }

const settings = shared('editor:settings', null)
const state = reactive({ fields: [] as Field[], open: true })

settings.subscribe((next: any) => {
  state.fields = (next?.fields ?? []).map((field: Field) => ({ ...field, ranged: field.type === 'number' && field.min !== undefined && field.max !== undefined, hex: field.type === 'colour' ? toHex(field.value) : undefined }))
})

function toHex(value: unknown): string {
  return '#' + Math.max(0, Math.min(0xffffff, Number(value) || 0)).toString(16).padStart(6, '0')
}

function apply(field: Field) {
  sendCommand({ type: 'setSetting', key: field.key, value: field.value })
}

function applySelect(event: Event, field: Field) {
  field.value = (event.target as HTMLSelectElement).value
  apply(field)
}

function pickFile(field: Field) {
  sendCommand({ type: 'setSetting', key: field.key, value: null, pick: true })
}

function clearFile(field: Field) {
  field.value = null
  apply(field)
}

function applyColour(event: Event, field: Field) {
  field.hex = (event.target as HTMLInputElement).value
  field.value = parseInt(field.hex.slice(1), 16)
  apply(field)
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
.control > .well:not(.colour) {
  flex: 1 1 auto;
}

.file {
  display: flex;
  align-items: center;
  gap: var(--cat-space-1);
  min-width: 0;
}

.file .name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file .small {
  flex: 0 0 auto;
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  padding: 0 var(--cat-space-1);
  cursor: pointer;
}

.colour {
  gap: var(--cat-space-2);
  padding-left: var(--cat-space-1);
  cursor: pointer;
}

.colour .swatch {
  flex: 0 0 32px;
  width: 32px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: var(--cat-radius-xs);
  background: none;
  cursor: pointer;
}

.colour .swatch::-webkit-color-swatch-wrapper {
  padding: 0;
}

.colour .swatch::-webkit-color-swatch {
  border: 0;
  border-radius: var(--cat-radius-xs);
}
</style>
