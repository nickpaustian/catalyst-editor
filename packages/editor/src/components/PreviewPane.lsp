<view>
<section class="preview-pane" $ref="frame" tabindex="-1" @keydown="keyDown($event)">
  <header class="bar" $if="shared['editor:preview'].open">
    <span class="title mono" $title="shared['editor:preview'].path">{{ state.name }}</span>
    <span class="meta mono" $if="state.natural">{{ state.natural }}{{ state.kind === 'image' ? ' · ' + state.zoomLabel : '' }}</span>
    <span class="sheet well select" $if="state.kind === 'component'"><select aria-label="Stylesheet" title="The slate stylesheet the component is styled by" $model="state.stylesheet" @change="chooseSheet()">
      <option value="" label="No stylesheet">No stylesheet</option>
      <option $for="sheet in shared['editor:preview'].stylesheets" $key="sheet" $value="sheet" $label="sheet">{{ sheet }}</option>
    </select></span>
    <span class="actions">
      <button type="button" class="tool" title="Mount it again with its cells as it starts them" $if="state.kind === 'component'" @click="resetComponent()">Reset</button>
      <button type="button" class="tool" title="Fit to the pane" $if="state.kind !== 'component'" $class="{ on: state.kind === 'image' && state.fitted }" @click="fit()">Fit</button>
      <button type="button" class="tool" title="Actual size" $if="state.kind === 'image'" $class="{ on: !state.fitted && state.zoom === 1 }" @click="actualSize()">1:1</button>
    </span>
  </header>
  <div class="stage" $ref="stage" $class="{ empty: !shared['editor:preview'].open }" @wheel="wheel($event)" @pointerdown="startPan($event)" @dblclick="toggleZoom($event)">
    <div class="model" $if="state.kind === 'model' && shared['editor:preview'].open" $ref="viewport"></div>
    <div class="component-view" $if="state.kind === 'component' && shared['editor:preview'].open">
      <div class="component-host" $ref="componentHost"></div>
      <aside class="inputs" $if="state.inputs.length">
        <div class="inputs-title">Cells and props</div>
        <label class="input" $for="input in state.inputs" $key="input.key" $title="input.kind === 'cell' ? 'a shared cell: what scripts and other components set' : 'a prop, passed when the component mounts'">
          <span class="input-name mono">{{ input.name }}<span class="input-kind">{{ input.kind }}</span></span>
          <input class="checkbox" type="checkbox" $if="input.type === 'boolean'" $checked="input.value === true" @change="setInput(input, $event)" />
          <input class="well" type="number" $if="input.type === 'number'" $value="input.text" @change="setInput(input, $event)" @keydown="$event.stopPropagation()" />
          <input class="well" type="text" $if="input.type === 'string'" $value="input.text" spellcheck="false" @change="setInput(input, $event)" @keydown="$event.stopPropagation()" />
          <input class="well mono json" type="text" $if="input.type === 'json'" spellcheck="false" title="JSON" $class="{ invalid: input.invalid }" $value="input.text" @change="setInput(input, $event)" @keydown="$event.stopPropagation()" />
        </label>
      </aside>
    </div>
    <p class="hint" $if="state.kind === 'model' && state.natural && shared['editor:preview'].open">drag turns · right-drag pans · wheel zooms · F frames</p>
    <img $if="state.kind === 'image' && shared['editor:preview'].url" $src="shared['editor:preview'].url" alt="" draggable="false" @load="loaded($event)" $style="'transform: translate(' + state.x + 'px, ' + state.y + 'px) scale(' + state.zoom + ')'" />
    <p class="error" $if="shared['editor:preview'].error">{{ shared['editor:preview'].error }}</p>
    <p class="error component-error mono" $if="state.kind === 'component' && state.componentError">{{ state.componentError }}</p>
    <div class="nothing" $if="!shared['editor:preview'].open">
      <span class="what">Nothing to preview</span>
      <span class="how">Choose an image, a model or a component in the files pane and press Space.</span>
    </div>
  </div>
</section>
</view>

<logic lang="ts">
import { reactive, shared, defineRefs, onMounted } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { PREVIEW_DEFAULT } from '../cells.ts'
import { ModelViewer } from '../previews.ts'
import { ComponentPreview, cellsOf, propsOf } from '../componentPreview.ts'

interface Input { key: string; kind: 'cell' | 'prop'; name: string; type: 'boolean' | 'number' | 'string' | 'json'; value: unknown; text: string; invalid: boolean }

const MAX_ZOOM = 32

const cell = shared('editor:preview', PREVIEW_DEFAULT)
const refs = defineRefs<{ frame: HTMLElement; stage: HTMLElement; viewport: HTMLElement; componentHost: HTMLElement }>()
const state = reactive({
  name: '',
  kind: 'image',
  stylesheet: '',
  inputs: [] as Input[],
  componentError: '',
  natural: '',
  imageWidth: 0,
  imageHeight: 0,
  x: 0,
  y: 0,
  zoom: 1,
  zoomLabel: '',
  fitted: true,
})

let shownPath = ''
let viewer: ModelViewer | null = null
let component: ComponentPreview | null = null
let shownSource = ''
let shownSheet = ''
// Props set by hand outlive an edit of the source; they go when another file is shown.
let propValues: Record<string, unknown> = {}
let cellWatchers: (() => void)[] = []

const typeOf = (value: unknown): Input['type'] => (typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : typeof value === 'string' || value === undefined ? 'string' : 'json')
const textOf = (value: unknown, type: Input['type']) => (type === 'json' ? JSON.stringify(value) : value === undefined ? '' : String(value))
const inputOf = (kind: Input['kind'], name: string, value: unknown): Input => {
  const type = typeOf(value)
  return { key: `${kind}:${name}`, kind, name, type, value, text: textOf(value, type), invalid: false }
}

function dropComponent() {
  for (const stop of cellWatchers.splice(0)) stop()
  component?.dispose()
  component = null
  shownSource = ''
  shownSheet = ''
  state.inputs = []
}

// The component is mounted once its host is on the page, and again when its text changes; its cells keep their values.
function showComponent(next: typeof PREVIEW_DEFAULT) {
  const host = refs.componentHost
  if (!host?.isConnected) return void requestAnimationFrame(() => cell.value?.path === next.path && showComponent(cell.value))
  if (component && component.host !== host) dropComponent()
  component ??= new ComponentPreview(host)
  const view = component
  if (next.source === shownSource) {
    if (next.stylesheetText !== shownSheet) view.restyle((shownSheet = next.stylesheetText))
    return
  }
  shownSource = next.source
  shownSheet = next.stylesheetText
  const declared = propsOf(next.source)
  const props = Object.fromEntries(Object.entries(declared).map(([name, initial]) => [name, name in propValues ? propValues[name] : initial]))
  void view.show(next.source, next.stylesheetText, props).then((error) => {
    if (component !== view || cell.value?.path !== next.path) return
    state.natural = error ? '' : describeInputs(declared)
    if (error) return void (state.componentError = error)
    state.componentError = ''
    for (const stop of cellWatchers.splice(0)) stop()
    const inputs: Input[] = []
    for (const name of cellsOf(next.source)) {
      const shared = view.cell(name)
      inputs.push(inputOf('cell', name, shared.value))
      // A cell the component itself changes shows its new value.
      cellWatchers.push(shared.subscribe((value: unknown) => {
        const at = state.inputs.findIndex((input) => input.key === `cell:${name}`)
        if (at >= 0) state.inputs[at] = inputOf('cell', name, value)
      }))
    }
    for (const [name, value] of Object.entries(props)) inputs.push(inputOf('prop', name, value))
    state.inputs = inputs
  })
}

function describeInputs(props: Record<string, unknown>): string {
  const cells = cellsOf(shownSource).length
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
  return `${count(cells, 'cell')} · ${count(Object.keys(props).length, 'prop')}`
}

function setInput(input: Input, event: Event) {
  const field = event.target as HTMLInputElement
  let value: unknown
  if (input.type === 'boolean') value = (field as HTMLInputElement).checked
  else if (input.type === 'number') value = Number(field.value)
  else if (input.type === 'string') value = field.value
  else {
    try {
      value = JSON.parse(field.value)
    } catch {
      const at = state.inputs.findIndex((each) => each.key === input.key)
      if (at >= 0) state.inputs[at] = { ...input, text: field.value, invalid: true }
      return
    }
  }
  if (input.kind === 'cell') return component?.cell(input.name).set(value)
  propValues[input.name] = value
  shownSource = ''
  showComponent(cell.value)
}

function chooseSheet() {
  sendCommand({ type: 'previewStylesheet', path: state.stylesheet })
}

function resetComponent() {
  propValues = {}
  dropComponent()
  if (cell.value?.open && cell.value.kind === 'component') showComponent(cell.value)
}

function dropViewer() {
  viewer?.dispose()
  viewer = null
}

// A model is shown once its viewport is on the page; the viewer is made for that element and let go with it.
function showModel(next: typeof PREVIEW_DEFAULT) {
  const host = refs.viewport
  if (!host?.isConnected || !next.loader) return void requestAnimationFrame(() => cell.value?.path === next.path && showModel(next))
  if (viewer && viewer.host !== host) dropViewer()
  viewer ??= new ModelViewer(host)
  void viewer.show(next.loader, next.path).then((held) => {
    if (cell.value?.path !== next.path) return
    state.natural = held ? `${held.meshes === 1 ? '1 mesh' : `${held.meshes} meshes`} · ${held.triangles.toLocaleString()} triangles` : 'nothing to show'
  })
}

cell.subscribe((next: typeof PREVIEW_DEFAULT | undefined) => {
  if (!next?.open) {
    shownPath = ''
    loadedSrc = ''
    dropViewer()
    dropComponent()
    return
  }
  if (next.kind === 'component') state.stylesheet = next.stylesheet
  if (next.path !== shownPath) {
    shownPath = next.path
    state.kind = next.kind
    state.name = next.path.replace(/^.*\//, '')
    state.natural = ''
    state.imageWidth = 0
    state.imageHeight = 0
    state.fitted = true
    propValues = {}
    dropComponent()
    state.componentError = ''
    if (next.kind === 'model') showModel(next)
    else dropViewer()
    setTimeout(() => refs.frame?.focus({ preventScroll: true }), 0)
  }
  // A component follows its draft and its stylesheet while the same file shows.
  if (next.kind === 'component') showComponent(next)
})

function close() {
  sendCommand({ type: 'closePreview' })
}

function keyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}

function stageSize(): { width: number; height: number } {
  const stage = refs.stage
  return stage?.isConnected ? { width: stage.clientWidth, height: stage.clientHeight } : { width: 0, height: 0 }
}

function showZoom() {
  state.zoomLabel = `${Math.round(state.zoom * 100)}%`
}

function place(zoom: number, x: number, y: number) {
  state.zoom = Math.min(MAX_ZOOM, Math.max(zoom, 0.01))
  state.x = x
  state.y = y
  showZoom()
}

// Fitted, the image is centred and as large as the stage allows, but never past its own size.
function fit() {
  if (state.kind === 'model') return viewer?.fit()
  if (!state.imageWidth) return
  const { width, height } = stageSize()
  const zoom = Math.min(1, width / state.imageWidth, height / state.imageHeight)
  state.fitted = true
  place(zoom, (width - state.imageWidth * zoom) / 2, (height - state.imageHeight * zoom) / 2)
}

function actualSize(at?: { x: number; y: number }) {
  if (!state.imageWidth) return
  const { width, height } = stageSize()
  const cx = at?.x ?? width / 2
  const cy = at?.y ?? height / 2
  // The point under the cursor stays put; from fit, the image centres on it.
  const ix = (cx - state.x) / state.zoom
  const iy = (cy - state.y) / state.zoom
  state.fitted = false
  place(1, cx - ix, cy - iy)
}

// Re-rendering sets the image's src again and it fires load again; only a new image is fitted.
let loadedSrc = ''

function loaded(event: Event) {
  const image = event.target as HTMLImageElement
  if (image.currentSrc === loadedSrc) return
  loadedSrc = image.currentSrc
  state.imageWidth = image.naturalWidth || 1
  state.imageHeight = image.naturalHeight || 1
  state.natural = `${image.naturalWidth}×${image.naturalHeight}`
  fit()
}

function local(event: MouseEvent): { x: number; y: number } {
  const rect = refs.stage!.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

function wheel(event: WheelEvent) {
  if (state.kind !== 'image' || !state.imageWidth) return
  event.preventDefault()
  const at = local(event)
  const zoom = Math.min(MAX_ZOOM, Math.max(0.01, state.zoom * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015))))
  const scale = zoom / state.zoom
  state.fitted = false
  place(zoom, at.x - (at.x - state.x) * scale, at.y - (at.y - state.y) * scale)
}

function toggleZoom(event: MouseEvent) {
  if (state.kind !== 'image') return
  if (state.fitted || state.zoom !== 1) actualSize(local(event))
  else fit()
}

/** Follow the pointer until it is let go, with the pointer captured by `target`. */
function follow(event: PointerEvent, target: HTMLElement, move: (dx: number, dy: number) => void, done?: () => void) {
  if (event.button !== 0) return
  event.preventDefault()
  target.setPointerCapture(event.pointerId)
  const startX = event.clientX
  const startY = event.clientY
  const onMove = (e: PointerEvent) => move(e.clientX - startX, e.clientY - startY)
  const onUp = () => {
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerup', onUp)
    target.removeEventListener('pointercancel', onUp)
    done?.()
  }
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerup', onUp)
  target.addEventListener('pointercancel', onUp)
}

function startPan(event: PointerEvent) {
  if (state.kind !== 'image') return
  const x = state.x
  const y = state.y
  follow(event, event.currentTarget as HTMLElement, (dx, dy) => {
    state.fitted = false
    state.x = x + dx
    state.y = y + dy
  })
}

onMounted(() => {
  // A fitted image keeps fitting as the pane is resized, docked or floating.
  const stage = refs.stage
  if (stage) new ResizeObserver(() => state.fitted && state.kind === 'image' && fit()).observe(stage)
})
</logic>

<style>
.preview-pane {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: var(--cat-bg-panel);
  outline: none;
}

.bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--cat-space-2);
  height: 30px;
  padding: 0 var(--cat-space-1) 0 var(--cat-space-3);
  border-bottom: 1px solid var(--cat-border);
}

.mono {
  font-family: var(--cat-font-mono);
}

.title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--cat-text-primary);
  font-size: var(--cat-text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  flex: 0 0 auto;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-sm);
}

.actions {
  flex: 0 0 auto;
  display: flex;
  gap: 2px;
}

.tool {
  height: 24px;
  min-width: 28px;
  padding: 0 var(--cat-space-1-5);
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--cat-text-secondary);
  font: inherit;
  font-size: var(--cat-text-sm);
  cursor: pointer;
}

.tool:hover {
  background: var(--cat-bg-hover);
  color: var(--cat-text-primary);
}

.tool.on {
  color: var(--cat-accent);
}

.close {
  display: grid;
  place-items: center;
  width: 24px;
  min-width: 24px;
  padding: 0;
}

.close svg {
  width: 14px;
  height: 14px;
}

.stage {
  position: relative;
  flex: 1 1 auto;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background-color: #1d1f24;
  background-image: linear-gradient(45deg, #26282e 25%, transparent 25%), linear-gradient(-45deg, #26282e 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #26282e 75%), linear-gradient(-45deg, transparent 75%, #26282e 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}

.stage:active {
  cursor: grabbing;
}

.stage img {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  image-rendering: auto;
  user-select: none;
  pointer-events: none;
}

.model {
  position: absolute;
  inset: 0;
  cursor: default;
}

.hint {
  position: absolute;
  left: var(--cat-space-2);
  bottom: var(--cat-space-1-5);
  margin: 0;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-sm);
  pointer-events: none;
}

.error {
  margin: var(--cat-space-4);
  color: var(--cat-danger);
}

.component-view {
  position: absolute;
  inset: 0;
  display: flex;
  cursor: default;
  background: var(--cat-bg-viewport);
}

.component-host {
  flex: 1 1 auto;
  min-width: 0;
  position: relative;
}

.inputs {
  flex: 0 0 220px;
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-2);
  padding: var(--cat-space-2) var(--cat-space-3);
  overflow-y: auto;
  border-left: 1px solid var(--cat-border);
  background: var(--cat-bg-panel);
}

.inputs-title {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.input {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-1);
}

.input:has(.checkbox) {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.input-name {
  display: flex;
  align-items: baseline;
  gap: var(--cat-space-1-5);
  min-width: 0;
  overflow: hidden;
  color: var(--cat-text-secondary);
  font-size: var(--cat-text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.input-kind {
  color: var(--cat-text-tertiary);
  font-family: var(--cat-font-ui);
  font-size: var(--cat-text-xs);
}

.input .json {
  font-size: var(--cat-text-xs);
}

.input .json.invalid {
  border-color: var(--cat-danger);
}

.component-error {
  position: absolute;
  left: var(--cat-space-3);
  right: 236px;
  bottom: var(--cat-space-2);
  margin: 0;
  padding: var(--cat-space-1-5) var(--cat-space-2);
  border-radius: var(--cat-radius-sm);
  background: var(--cat-bg-raised);
  font-size: var(--cat-text-sm);
}

.sheet {
  flex: 0 1 200px;
  min-width: 0;
}

.stage.empty {
  display: grid;
  place-items: center;
  cursor: default;
  background: var(--cat-bg-panel);
}

.nothing {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--cat-space-1);
  padding: var(--cat-space-4);
  text-align: center;
}

.nothing .what {
  color: var(--cat-text-secondary);
}

.nothing .how {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-sm);
}
</style>
