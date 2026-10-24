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
          <button $else-if="field.type === 'file'" class="well file-pick" type="button" $class="{ missing: field.missing, droppable: field.droppable, over: field.over }" $aria-label="field.label" $title="field.value || 'None'" $disabled="field.readonly" @click="openFile($event, field)" @dragover="fileOver($event, field)" @dragleave="field.over = false" @drop="dropFile($event, field)">
            <span class="file-name" $class="{ empty: !field.value }">{{ field.display }}</span>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg>
          </button>
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
import { DRAGGING_FILE_CELL, accepts, basename, openFilePicker } from '../fileField.ts'

interface Field { key: string; label: string; type: string; value: unknown; min?: number; max?: number; step?: number; options?: string[]; accept?: string; ranged?: boolean; hex?: string; choices?: string[]; display?: string; missing?: boolean; readonly?: boolean; droppable?: boolean; over?: boolean }

const settings = shared('editor:settings', null)
const dragging = shared(DRAGGING_FILE_CELL, null)
const state = reactive({ fields: [] as Field[], open: true })

settings.subscribe((next: any) => {
  state.fields = (next?.fields ?? []).map((field: Field) => ({ ...field, ranged: field.type === 'number' && field.min !== undefined && field.max !== undefined, hex: field.type === 'colour' ? toHex(field.value) : undefined, ...fileDisplay(field) }))
  markDroppable(state.fields, dragging.value ?? null)
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

function fileDisplay(field: Field) {
  if (field.type !== 'file') return {}
  const value = typeof field.value === 'string' ? field.value : ''
  return { display: value ? basename(value) : 'None', missing: Boolean(value) && !(field.choices ?? []).includes(value) }
}

function openFile(event: Event, field: Field) {
  openFilePicker({
    trigger: event.currentTarget as HTMLElement,
    value: typeof field.value === 'string' ? field.value : null,
    choices: field.choices ?? [],
    pick: (path) => {
      field.value = path
      apply(field)
    },
    importFile: () => sendCommand({ type: 'setSetting', key: field.key, value: null, pick: true }),
  })
}

// A file dragged from the files pane lights up the fields that take it; a drop on one points it there
function fileOver(event: DragEvent, field: Field) {
  if (!field.droppable || !event.dataTransfer) return
  event.preventDefault()
  event.stopPropagation()
  event.dataTransfer.dropEffect = 'link'
  field.over = true
}

function droppedFile(event: DragEvent, field: Field): string | null {
  field.over = false
  const path = dragging.value || event.dataTransfer?.getData('text/catalyst-file')
  if (!field.droppable || !path) return null
  event.preventDefault()
  event.stopPropagation()
  return path
}

function markDroppable(fields: Field[], path: string | null) {
  for (const field of fields) {
    if (field.type !== 'file') continue
    field.droppable = Boolean(path) && !field.readonly && accepts(field.accept, path!)
    field.over = false
  }
}

function dropFile(event: DragEvent, field: Field) {
  const path = droppedFile(event, field)
  if (!path) return
  field.value = path
  apply(field)
}

dragging.subscribe((path: string | null | undefined) => markDroppable(state.fields, path ?? null))

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
