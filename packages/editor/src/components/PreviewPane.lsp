<view>
<section class="preview-pane" $ref="frame" tabindex="-1" @keydown="keyDown($event)">
  <header class="bar" $if="shared['editor:preview'].open">
    <span class="title mono" $title="shared['editor:preview'].path">{{ state.name }}</span>
    <span class="meta mono" $if="state.natural">{{ state.natural }}{{ state.kind === 'image' ? ' · ' + state.zoomLabel : '' }}</span>
    <span class="actions">
      <button type="button" class="tool" title="Fit to the pane" $class="{ on: state.kind === 'image' && state.fitted }" @click="fit()">Fit</button>
      <button type="button" class="tool" title="Actual size" $if="state.kind === 'image'" $class="{ on: !state.fitted && state.zoom === 1 }" @click="actualSize()">1:1</button>
    </span>
  </header>
  <div class="stage" $ref="stage" $class="{ empty: !shared['editor:preview'].open }" @wheel="wheel($event)" @pointerdown="startPan($event)" @dblclick="toggleZoom($event)">
    <div class="model" $if="state.kind === 'model' && shared['editor:preview'].open" $ref="viewport"></div>
    <p class="hint" $if="state.kind === 'model' && state.natural && shared['editor:preview'].open">drag turns · right-drag pans · wheel zooms · F frames</p>
    <img $if="state.kind === 'image' && shared['editor:preview'].url" $src="shared['editor:preview'].url" alt="" draggable="false" @load="loaded($event)" $style="'transform: translate(' + state.x + 'px, ' + state.y + 'px) scale(' + state.zoom + ')'" />
    <p class="error" $if="shared['editor:preview'].error">{{ shared['editor:preview'].error }}</p>
    <div class="nothing" $if="!shared['editor:preview'].open">
      <span class="what">Nothing to preview</span>
      <span class="how">Choose an image or a model in the files pane and press Space.</span>
    </div>
  </div>
</section>
</view>

<logic lang="ts">
import { reactive, shared, defineRefs, onMounted } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { PREVIEW_DEFAULT } from '../cells.ts'
import { ModelViewer } from '../previews.ts'

const MAX_ZOOM = 32

const cell = shared('editor:preview', PREVIEW_DEFAULT)
const refs = defineRefs<{ frame: HTMLElement; stage: HTMLElement; viewport: HTMLElement }>()
const state = reactive({
  name: '',
  kind: 'image',
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
    return
  }
  if (next.path !== shownPath) {
    shownPath = next.path
    state.kind = next.kind
    state.name = next.path.replace(/^.*\//, '')
    state.natural = ''
    state.imageWidth = 0
    state.imageHeight = 0
    state.fitted = true
    if (next.kind === 'model') showModel(next)
    else dropViewer()
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
