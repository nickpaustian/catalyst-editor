<view>
<div class="picker menu-panel" $if="state.open" role="dialog" aria-label="Choose a file" @pointerdown="$event.stopPropagation()" @keydown="key($event)">
  <label class="well filter">
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 4 4"/></svg>
    <input type="search" placeholder="Filter" aria-label="Filter files" autocomplete="off" spellcheck="false" $model="state.filter" @input="refresh()" />
  </label>
  <div class="list" role="listbox">
    <button class="menu-item" type="button" role="option" data-index="0" $class="{ active: state.active === 0, current: !state.value }" $aria-selected="!state.value" @click="choose(null)" @pointermove="state.active = 0">
      <span class="icon"></span>
      <span class="name">None</span>
    </button>
    <div class="group" $for="group in state.groups" $key="group.name">
      <div class="group-name" $if="state.headers">{{ group.name }}</div>
      <button
        class="menu-item"
        type="button"
        role="option"
        $for="item in group.items"
        $key="item.path"
        $data-index="item.index"
        $class="{ active: state.active === item.index, current: item.path === state.value, missing: item.missing }"
        $aria-selected="item.path === state.value"
        $title="item.path"
        @click="choose(item.path)"
        @pointermove="state.active = item.index"
      >
        <span class="icon" $html="item.icon"></span>
        <span class="name">{{ item.name }}</span>
        <span class="dir">{{ item.dir }}</span>
      </button>
    </div>
    <p class="no-match" $if="!state.count && state.filter">Nothing matches “{{ state.filter }}”.</p>
    <p class="no-match" $if="!state.count && !state.filter">No files of this kind in the project.</p>
  </div>
  <div class="import" $if="state.canImport">
    <hr />
    <button class="menu-item" type="button" role="option" $data-index="state.importIndex" $class="{ active: state.active === state.importIndex }" @click="importFile()" @pointermove="state.active = state.importIndex">
      <span class="icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M2.5 13.5h11"/></svg></span>
      <span class="name">Import from disk…</span>
    </button>
  </div>
</view>

<logic lang="ts">
import { reactive, shared, onMounted } from '@lightspeed-js/core'
import { FILE_PICKER_CELL, basename, fileKind, groupOrder, type FilePickerRequest } from '../fileField.ts'

interface Item { index: number; path: string; name: string; dir: string; icon: string; missing: boolean }
interface Group { name: string; items: Item[] }

const cell = shared(FILE_PICKER_CELL, null)
const state = reactive({ open: false, filter: '', value: null as string | null, groups: [] as Group[], headers: false, count: 0, active: 0, canImport: false, importIndex: 1 })
let request: FilePickerRequest | null = null

function close(refocus = false) {
  const trigger = request?.trigger
  request = null
  state.open = false
  if (cell.value) cell.set(null)
  if (refocus) trigger?.focus()
}

cell.subscribe((next: FilePickerRequest | null | undefined) => {
  if (!next) {
    if (state.open) close()
    return
  }
  if (state.open && request?.trigger === next.trigger) return close()
  request = next
  state.value = next.value || null
  state.filter = ''
  state.canImport = Boolean(next.importFile)
  refresh()
  state.active = activeForValue()
  state.open = true
  placeWhenRendered(++opening)
})

// Files grouped by kind, groups in a fixed order and files by path within
// them; the current value is listed, marked missing, when no file answers
// to it. Indices run through the list in order for the keyboard: None is 0
// and the import row comes last.
function refresh() {
  if (!request) return
  const terms = state.filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const paths = [...request.choices]
  const missing = state.value && !paths.includes(state.value) ? state.value : null
  if (missing) paths.push(missing)
  const byGroup = new Map<string, Item[]>()
  for (const path of paths.sort()) {
    if (terms.some((term) => !path.toLowerCase().includes(term))) continue
    const kind = fileKind(path)
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const items = byGroup.get(kind.group) ?? []
    items.push({ index: 0, path, name: basename(path), dir, icon: kind.icon, missing: path === missing })
    byGroup.set(kind.group, items)
  }
  const groups = [...byGroup.entries()].sort((a, b) => groupOrder(a[0]) - groupOrder(b[0])).map(([name, items]) => ({ name, items }))
  let index = 1
  for (const group of groups) for (const item of group.items) item.index = index++
  state.groups = groups
  state.headers = groups.length > 1
  state.count = index - 1
  state.importIndex = index
  const last = state.canImport ? index : index - 1
  if (state.filter) state.active = state.count ? 1 : 0
  else if (state.active > last) state.active = last
}

function activeForValue(): number {
  for (const group of state.groups) for (const item of group.items) if (item.path === state.value) return item.index
  return 0
}

function choose(path: string | null) {
  const current = request
  close(true)
  current?.pick(path)
}

function importFile() {
  const current = request
  close(true)
  current?.importFile?.()
}

function pickActive() {
  if (state.active === 0) return choose(null)
  if (state.canImport && state.active === state.importIndex) return importFile()
  for (const group of state.groups) for (const item of group.items) if (item.index === state.active) return choose(item.path)
}

function key(event: KeyboardEvent) {
  const last = state.canImport ? state.importIndex : state.count
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    state.active = Math.max(0, Math.min(last, state.active + (event.key === 'ArrowDown' ? 1 : -1)))
    requestAnimationFrame(revealActive)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    pickActive()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
  } else if (event.key === 'Tab') {
    close()
  }
}

function revealActive() {
  document.querySelector<HTMLElement>(`#file-picker [data-index="${state.active}"]`)?.scrollIntoView({ block: 'nearest' })
}

let opening = 0

// The element appears with the render, a frame or two after the state
// changes, so placement waits for it (and gives up if the picker closed first)
function placeWhenRendered(id: number, tries = 0) {
  if (id !== opening || !state.open || !request) return
  const picker = document.querySelector<HTMLElement>('#file-picker .picker')
  if (picker) return place(picker, request.trigger)
  if (tries < 90) requestAnimationFrame(() => placeWhenRendered(id, tries + 1))
}

// Under the field and at least as wide, above it when there is more room there
function place(picker: HTMLElement, trigger: HTMLElement) {
  const anchor = trigger.getBoundingClientRect()
  const gap = 4
  const width = Math.min(window.innerWidth - 8, Math.max(anchor.width, 280))
  const below = window.innerHeight - anchor.bottom - gap - 4
  const above = anchor.top - gap - 4
  const room = below >= 240 || below >= above ? below : above
  picker.style.width = `${width}px`
  picker.style.maxHeight = `${Math.min(420, room)}px`
  picker.style.left = `${Math.max(4, Math.min(anchor.left, window.innerWidth - width - 4))}px`
  if (room === below) picker.style.top = `${anchor.bottom + gap}px`
  else picker.style.top = `${Math.max(4, anchor.top - gap - picker.getBoundingClientRect().height)}px`
  picker.classList.add('placed')
  picker.querySelector<HTMLInputElement>('input')?.focus()
  revealActive()
}

// A press outside closes it; one on the field that opened it is left to
// the field, whose click closes it again
function closeFromOutside(event: PointerEvent) {
  if (!state.open) return
  const target = event.target as Node | null
  if (target && (document.getElementById('file-picker')?.contains(target) || request?.trigger.contains(target))) return
  close()
}

onMounted(() => {
  document.addEventListener('pointerdown', closeFromOutside, true)
  window.addEventListener('blur', () => close())
  window.addEventListener('resize', () => close())
})
</logic>

<style>
.picker {
  position: fixed;
  z-index: 2500;
  visibility: hidden;
  gap: var(--cat-space-1);
  overflow: hidden;
}

.picker.placed {
  visibility: visible;
}

.filter {
  flex: 0 0 auto;
}

.filter svg {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  color: var(--cat-text-tertiary);
}

.list {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.group {
  display: flex;
  flex-direction: column;
}

.group-name {
  padding: var(--cat-space-1-5) var(--cat-space-2) var(--cat-space-1);
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.menu-item.active {
  background: var(--cat-bg-hover);
}

.menu-item.current .name {
  color: var(--cat-accent);
}

.menu-item.missing .name {
  color: var(--cat-danger);
  text-decoration: line-through;
}

.icon {
  display: inline-flex;
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  color: var(--cat-text-secondary);
}

.icon svg {
  width: 14px;
  height: 14px;
}

.name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dir {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
  direction: rtl;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
}

.no-match {
  margin: 0;
  padding: var(--cat-space-2);
  color: var(--cat-text-tertiary);
}

.import {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
}
</style>
