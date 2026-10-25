<view>
<section class="preview-window" $if="shared['editor:preview'].open" $ref="frame" role="dialog" aria-label="Preview" tabindex="-1" $style="'left: ' + state.left + 'px; top: ' + state.top + 'px; width: ' + state.width + 'px; height: ' + state.height + 'px'" @keydown="keyDown($event)">
  <header class="bar" @pointerdown="startMove($event)" @dblclick="fit()">
    <span class="title mono" $title="shared['editor:preview'].path">{{ state.name }}</span>
    <span class="meta mono" $if="state.natural">{{ state.natural }} · {{ state.zoomLabel }}</span>
    <span class="actions">
      <button type="button" class="tool" title="Fit to the window (double-click the bar)" $class="{ on: state.fitted }" @click="fit()">Fit</button>
      <button type="button" class="tool" title="Actual size" $class="{ on: !state.fitted && state.zoom === 1 }" @click="actualSize()">1:1</button>
      <button type="button" class="tool close" title="Close (Esc)" aria-label="Close" @click="close()">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>
      </button>
    </span>
  </header>
  <div class="stage" $ref="stage" @wheel="wheel($event)" @pointerdown="startPan($event)" @dblclick="toggleZoom($event)">
    <img $if="shared['editor:preview'].url" $src="shared['editor:preview'].url" alt="" draggable="false" @load="loaded($event)" $style="'transform: translate(' + state.x + 'px, ' + state.y + 'px) scale(' + state.zoom + ')'" />
    <p class="error" $if="shared['editor:preview'].error">{{ shared['editor:preview'].error }}</p>
  </div>
  <div class="edge n" @pointerdown="startResize($event, 'n')"></div>
  <div class="edge s" @pointerdown="startResize($event, 's')"></div>
  <div class="edge e" @pointerdown="startResize($event, 'e')"></div>
  <div class="edge w" @pointerdown="startResize($event, 'w')"></div>
  <div class="edge ne" @pointerdown="startResize($event, 'ne')"></div>
  <div class="edge nw" @pointerdown="startResize($event, 'nw')"></div>
  <div class="edge se" @pointerdown="startResize($event, 'se')"></div>
  <div class="edge sw" @pointerdown="startResize($event, 'sw')"></div>
</section>
</view>

<logic lang="ts">
import { reactive, shared, defineRefs, onMounted } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { PREVIEW_DEFAULT } from '../cells.ts'
import { storage } from '../preferences.ts'

const RECT_KEY = 'previewWindow'
const MIN_WIDTH = 240
const MIN_HEIGHT = 180
const MAX_ZOOM = 32
// A margin of the window that must stay on screen, so its bar can always be reached.
const KEEP = 48

interface Rect { left: number; top: number; width: number; height: number }

const cell = shared('editor:preview', PREVIEW_DEFAULT)
const refs = defineRefs<{ frame: HTMLElement; stage: HTMLElement }>()
const saved = storage.get<Rect | null>(RECT_KEY, null)
const state = reactive({
  left: saved?.left ?? Math.max(16, window.innerWidth - 640),
  top: saved?.top ?? 96,
  width: saved?.width ?? 560,
  height: saved?.height ?? 440,
  name: '',
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
cell.subscribe((next: typeof PREVIEW_DEFAULT | undefined) => {
  if (!next?.open) {
    shownPath = ''
    loadedSrc = ''
    return
  }
  if (next.path !== shownPath) {
    shownPath = next.path
    state.name = next.path.replace(/^.*\//, '')
    state.natural = ''
    state.imageWidth = 0
    state.imageHeight = 0
    state.fitted = true
    clampWindow()
    setTimeout(() => refs.frame?.focus({ preventScroll: true }), 0)
  }
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
  return stage?.isConnected ? { width: stage.clientWidth, height: stage.clientHeight } : { width: state.width, height: state.height - 32 }
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
  if (!state.imageWidth) return
  event.preventDefault()
  const at = local(event)
  const zoom = Math.min(MAX_ZOOM, Math.max(0.01, state.zoom * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015))))
  const scale = zoom / state.zoom
  state.fitted = false
  place(zoom, at.x - (at.x - state.x) * scale, at.y - (at.y - state.y) * scale)
}

function toggleZoom(event: MouseEvent) {
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
  const x = state.x
  const y = state.y
  follow(event, event.currentTarget as HTMLElement, (dx, dy) => {
    state.fitted = false
    state.x = x + dx
    state.y = y + dy
  })
}

function startMove(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button')) return
  const left = state.left
  const top = state.top
  follow(event, event.currentTarget as HTMLElement, (dx, dy) => {
    state.left = left + dx
    state.top = top + dy
    clampWindow()
  }, remember)
}

function startResize(event: PointerEvent, edge: string) {
  const start: Rect = { left: state.left, top: state.top, width: state.width, height: state.height }
  follow(event, event.currentTarget as HTMLElement, (dx, dy) => {
    if (edge.includes('e')) state.width = Math.max(MIN_WIDTH, start.width + dx)
    if (edge.includes('s')) state.height = Math.max(MIN_HEIGHT, start.height + dy)
    if (edge.includes('w')) {
      state.width = Math.max(MIN_WIDTH, start.width - dx)
      state.left = start.left + start.width - state.width
    }
    if (edge.includes('n')) {
      state.height = Math.max(MIN_HEIGHT, start.height - dy)
      state.top = start.top + start.height - state.height
    }
    clampWindow()
    if (state.fitted) requestAnimationFrame(fit)
  }, remember)
}

// The window stays reachable: no larger than the page, and its bar never off the top or out of reach at the sides.
function clampWindow() {
  state.width = Math.min(state.width, window.innerWidth)
  state.height = Math.min(state.height, window.innerHeight)
  state.left = Math.min(Math.max(state.left, KEEP - state.width), window.innerWidth - KEEP)
  state.top = Math.min(Math.max(state.top, 0), window.innerHeight - KEEP)
}

function remember() {
  storage.set<Rect>(RECT_KEY, { left: state.left, top: state.top, width: state.width, height: state.height })
}

onMounted(() => {
  window.addEventListener('resize', () => {
    if (!cell.value?.open) return
    clampWindow()
    if (state.fitted) fit()
  })
})
</logic>

<style>
.preview-window {
  position: fixed;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  min-width: 240px;
  min-height: 180px;
  border: 1px solid var(--cat-border);
  border-radius: 8px;
  background: var(--cat-bg-raised);
  box-shadow: 0 12px 40px rgb(0 0 0 / 45%);
  outline: none;
}

.bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: var(--cat-space-2);
  height: 32px;
  padding: 0 var(--cat-space-1) 0 var(--cat-space-3);
  border-bottom: 1px solid var(--cat-border);
  border-radius: 8px 8px 0 0;
  background: var(--cat-bg-panel);
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.bar:active {
  cursor: grabbing;
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
  border-radius: 0 0 8px 8px;
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

.error {
  margin: var(--cat-space-4);
  color: var(--cat-danger);
}

.edge {
  position: absolute;
  z-index: 1;
}

.edge.n,
.edge.s {
  left: 8px;
  right: 8px;
  height: 6px;
  cursor: ns-resize;
}

.edge.n {
  top: -3px;
}

.edge.s {
  bottom: -3px;
}

.edge.e,
.edge.w {
  top: 8px;
  bottom: 8px;
  width: 6px;
  cursor: ew-resize;
}

.edge.e {
  right: -3px;
}

.edge.w {
  left: -3px;
}

.edge.ne,
.edge.nw,
.edge.se,
.edge.sw {
  width: 12px;
  height: 12px;
}

.edge.ne {
  top: -3px;
  right: -3px;
  cursor: nesw-resize;
}

.edge.nw {
  top: -3px;
  left: -3px;
  cursor: nwse-resize;
}

.edge.se {
  bottom: -3px;
  right: -3px;
  cursor: nwse-resize;
}

.edge.sw {
  bottom: -3px;
  left: -3px;
  cursor: nesw-resize;
}
</style>
