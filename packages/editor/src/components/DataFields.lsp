<view>
<div class="data" $if="shared['editor:data']">
  <div class="data-header">
    <div class="title">
      <span class="name">{{ shared['editor:data'].name }}</span>
      <span class="type">{{ shared['editor:data'].className || 'Data' }}</span>
    </div>
    <button class="button small" type="button" title="Back to the scene's selection" @click="close">Close</button>
  </div>
  <p class="data-note">{{ shared['editor:data'].path }}<span $if="shared['editor:data'].base"> · over {{ shared['editor:data'].base }}</span> · saved as you edit<span $if="shared['editor:data'].canUndo"> · undo steps back through this file</span></p>
  <div class="properties data-rows">
    <template $for="row in shared['editor:data'].rows" $key="row.id">
      <span class="label" $class="{ head: row.row !== 'field', inherited: row.inherited }" $style="'--depth: ' + row.depth" $title="row.label">{{ row.label }}</span>
      <div class="control">
        <template $if="row.row === 'list'">
          <span class="count">{{ row.count }} {{ row.count === 1 ? 'entry' : 'entries' }}</span>
          <select $if="row.kinds && row.kinds.length > 1" class="well kind" $aria-label="'Kind to add to ' + row.label" @change="pickAddKind($event, row)">
            <option $for="kind in row.kinds" $value="kind" $label="kind" $selected="kind === (state.addKinds[row.id] || row.kinds[0])">{{ kind }}</option>
          </select>
          <button class="button small" type="button" $aria-label="'Add to ' + row.label" @click="add(row)">Add</button>
        </template>
        <template $else-if="row.type === 'data'">
          <select class="well kind" $aria-label="row.label + ' kind'" @change="setKind($event, row)">
            <option value="" $selected="!row.kind" $if="row.row !== 'item'">None</option>
            <option $for="kind in row.kinds" $value="kind" $label="kind" $selected="kind === row.kind">{{ kind }}</option>
          </select>
          <template $if="row.row === 'item'">
            <button class="icon-button small" type="button" aria-label="Move up" $disabled="row.first" @click="move(row, -1)">↑</button>
            <button class="icon-button small" type="button" aria-label="Move down" $disabled="row.last" @click="move(row, 1)">↓</button>
            <button class="icon-button small" type="button" aria-label="Remove" @click="remove(row)">×</button>
          </template>
        </template>
        <template $else>
          <div class="well" $if="row.type === 'number'">
            <input type="number" $step="row.step || 'any'" $min="row.min" $max="row.max" $aria-label="row.label" $value="row.value" @change="setNumber($event, row)" />
          </div>
          <input $else-if="row.type === 'boolean'" class="checkbox" type="checkbox" $aria-label="row.label" $checked="row.value" @change="setChecked($event, row)" />
          <textarea $else-if="row.type === 'text'" class="well" rows="2" $aria-label="row.label" $model="row.value" @change="setText($event, row)"></textarea>
          <select $else-if="row.type === 'select'" class="well" $aria-label="row.label" @change="setText($event, row)">
            <option $for="option in row.options" $value="option" $label="option" $selected="option === row.value">{{ option }}</option>
          </select>
          <div $else-if="row.type === 'flags'" class="flags">
            <label $for="option in row.options" $key="option" class="flag"><input class="checkbox" type="checkbox" $checked="(row.value || []).includes(option)" @change="setFlag($event, row, option)" />{{ option }}</label>
          </div>
          <select $else-if="row.type === 'ref'" class="well" $aria-label="row.label" @change="setRef($event, row)">
            <option value="" $selected="!row.value">None</option>
            <option $for="choice in row.choices" $value="choice.path" $label="choice.name" $selected="choice.path === row.value">{{ choice.name }}</option>
            <option $if="row.value && !(row.choices || []).some((choice) => choice.path === row.value)" $value="row.value" $label="row.value + ' (not found)'" $selected="true">{{ row.value }}</option>
          </select>
          <div class="well" $else>
            <input type="text" $aria-label="row.label" $value="row.value == null ? '' : row.value" @change="setText($event, row)" />
          </div>
          <template $if="row.row === 'item'">
            <button class="icon-button small" type="button" aria-label="Remove" @click="remove(row)">×</button>
          </template>
        </template>
        <button $if="row.overrides" class="icon-button small" type="button" $aria-label="'Back to the base\'s ' + row.label" title="Back to the base's value" @click="reset(row)">↺</button>
      </div>
    </template>
  </div>
  <p class="data-status" $class="{ problem: shared['editor:data'].problem }" $if="shared['editor:data'].status">{{ shared['editor:data'].status }}</p>
</div>
</view>

<logic lang="ts">
import { sendCommand } from '../commands.ts'

// A data file open in the inspector, as rows the session lays out from its
// class's exposed fields: every change is a command, and the session writes
// the file and publishes the rows again.
shared('editor:data', null)

interface Row { id: string; path: (string | number)[]; label: string; row: string; type: string; value?: unknown; kinds?: string[]; kind?: string; inherited?: boolean; overrides?: boolean }

const state = reactive({ addKinds: {} as Record<string, string> })

function close() {
  sendCommand({ type: 'closeData' })
}

function set(row: Row, value: unknown) {
  sendCommand({ type: 'dataSet', path: row.path, value })
}

function setNumber(event: Event, row: Row) {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isNaN(value)) set(row, value)
}

function setChecked(event: Event, row: Row) {
  set(row, (event.target as HTMLInputElement).checked)
}

function setText(event: Event, row: Row) {
  set(row, (event.target as HTMLInputElement).value)
}

function setRef(event: Event, row: Row) {
  set(row, (event.target as HTMLSelectElement).value || null)
}

function setFlag(event: Event, row: Row, option: string) {
  const on = (event.target as HTMLInputElement).checked
  const names = ((row.value as string[]) || []).filter((name) => name !== option)
  set(row, on ? [...names, option] : names)
}

function setKind(event: Event, row: Row) {
  sendCommand({ type: 'dataKind', path: row.path, kind: (event.target as HTMLSelectElement).value })
}

function pickAddKind(event: Event, row: Row) {
  state.addKinds = { ...state.addKinds, [row.id]: (event.target as HTMLSelectElement).value }
}

function add(row: Row) {
  sendCommand({ type: 'dataAdd', path: row.path, kind: row.kinds ? state.addKinds[row.id] || row.kinds[0] : undefined })
}

function remove(row: Row) {
  sendCommand({ type: 'dataRemove', path: row.path })
}

function move(row: Row, by: number) {
  sendCommand({ type: 'dataMove', path: row.path, by })
}

function reset(row: Row) {
  sendCommand({ type: 'dataReset', path: row.path })
}
</logic>

<style>
.data-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--cat-space-2);
  padding: calc(var(--cat-space-2) + var(--cat-space-0-5)) var(--cat-space-3);
  border-bottom: 1px solid var(--cat-border-subtle);
}

.data-header .title {
  display: flex;
  align-items: baseline;
  gap: var(--cat-space-2);
  min-width: 0;
}

.data-header .name {
  overflow: hidden;
  font: 500 var(--cat-text-md) / var(--cat-leading-body) var(--cat-font-ui);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-header .type,
.data-note,
.count {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.data-note {
  margin: 0;
  padding: var(--cat-space-1-5) var(--cat-space-3);
  border-bottom: 1px solid var(--cat-border-subtle);
  font-family: var(--cat-font-mono);
}

.data-rows {
  padding: var(--cat-space-2) var(--cat-space-3);
}

.data-rows > .label {
  padding-left: calc(var(--depth, 0) * 12px);
}

.data-rows > .label.head {
  color: var(--cat-text-primary);
  font-weight: 500;
}

.data-rows > .label.inherited {
  color: var(--cat-text-tertiary);
  font-style: italic;
}

.data-rows .well {
  flex: 1 1 auto;
}

.data-rows .well input,
.data-rows textarea {
  width: 100%;
}

.data-rows textarea {
  height: auto;
  padding: var(--cat-space-1) var(--cat-space-2);
  resize: vertical;
}

.data-rows .kind {
  flex: 1 1 auto;
}

.count {
  flex: 1 1 auto;
}

.flags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--cat-space-1) var(--cat-space-2);
}

.flag {
  display: inline-flex;
  align-items: center;
  gap: var(--cat-space-1);
  color: var(--cat-text-secondary);
}

.data-status {
  margin: 0;
  padding: var(--cat-space-2) var(--cat-space-3);
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.data-status.problem {
  color: var(--cat-danger, #f07070);
}
</style>
