<view>
<aside class="panel">
  <div class="empty-state" $if="!shared['editor:settings']">
    <span class="what">No project open</span>
    <span class="how">The scene's lighting and sky are set here.</span>
  </div>
  <div class="settings" $else>
    <template $for="section in state.sections" $key="section.title">
      <section class="section">
        <button class="section-header" type="button" $aria-expanded="section.open" @click="toggle(section)"><span class="title">{{ section.title }}</span></button>
        <div class="section-body" $if="section.open">
          <div class="properties">
            <template $for="field in section.fields" $key="field.key">
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
                    <option $value="choice" $label="choice" $selected="choice === field.value">{{ choice }}</option>
                  </template>
                </select>
                <button $else-if="field.type === 'file'" class="well file-pick" type="button" $class="{ missing: field.missing, droppable: field.droppable, over: field.over }" $aria-label="field.label" $title="field.value || 'None'" $disabled="field.readonly" @click="openFile($event, field)" @dragover="fileOver($event, field)" @dragleave="field.over = false" @drop="dropFile($event, field)">
                  <span class="file-name" $class="{ empty: !field.value }">{{ field.display }}</span>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5"/></svg>
                </button>
                <textarea $else-if="field.type === 'text'" class="well" rows="3" $aria-label="field.label" $model="field.value" @change="apply(field)"></textarea>
                <input $else class="well" type="text" $aria-label="field.label" $model="field.value" @change="apply(field)" />
              </div>
            </template>
          </div>
        </div>
      </section>
    </template>
  </div>
</aside>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { scrub } from '../scrub.ts'
import { DRAGGING_FILE_CELL, accepts, basename, openFilePicker } from '../fileField.ts'

interface Field { key: string; label: string; type: string; value: unknown; min?: number; max?: number; step?: number; options?: string[]; accept?: string; ranged?: boolean; hex?: string; choices?: string[]; display?: string; missing?: boolean; readonly?: boolean; droppable?: boolean; over?: boolean; section?: string }

interface Section { title: string; open: boolean; fields: Field[] }

const settings = shared('editor:settings', null)
const dragging = shared(DRAGGING_FILE_CELL, null)
const state = reactive({ sections: [] as Section[] })
const closed = new Set<string>()

settings.subscribe((next: any) => {
  const sections: Section[] = []
  for (const field of (next?.fields ?? []) as Field[]) {
    const title = field.section ?? next.title
    let section = sections[sections.length - 1]
    if (section?.title !== title) sections.push(section = { title, open: !closed.has(title), fields: [] })
    section.fields.push({ ...field, ranged: field.type === 'number' && field.min !== undefined && field.max !== undefined, hex: field.type === 'colour' ? toHex(field.value) : undefined, ...fileDisplay(field) })
  }
  state.sections = sections
  markAllDroppable(dragging.value ?? null)
})

function toggle(section: Section) {
  section.open = !section.open
  if (section.open) closed.delete(section.title)
  else closed.add(section.title)
}

function markAllDroppable(path: string | null) {
  for (const section of state.sections) markDroppable(section.fields, path)
}

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

dragging.subscribe((path: string | null | undefined) => markAllDroppable(path ?? null))

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
.panel {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  background: var(--cat-bg-panel);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / var(--cat-leading-body) var(--cat-font-ui);
}

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
