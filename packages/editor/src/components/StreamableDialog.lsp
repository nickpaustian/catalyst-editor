<view>
<div class="scrim" $if="state.open" @pointerdown="close()">
  <form class="dialog" role="dialog" aria-modal="true" aria-labelledby="streamable-title" @pointerdown="$event.stopPropagation()" @submit="start($event)">
    <h2 class="dialog-title" id="streamable-title">{{ state.rebuilding ? 'Rebuild' : 'Make streamable' }}</h2>
    <p class="lead">Cuts <span class="mono">{{ state.source }}</span> into a cluster hierarchy and its maps into tile pyramids, for a streamed surface that loads only the detail the view needs.</p>

    <p class="hint" $if="state.phase === 'reading'">Reading the file…</p>

    <template $if="state.phase === 'choose'">
      <label class="dialog-field" $if="state.meshes.length > 1">Mesh
        <span class="well large select">
          <select $model="state.mesh" @change="picked()">
            <option $for="mesh in state.meshes" $key="mesh.index" $value="String(mesh.index)" $selected="String(mesh.index) === state.mesh" $disabled="!mesh.buildable" $label="mesh.label">{{ mesh.label }}</option>
          </select>
        </span>
      </label>
      <p class="facts" $if="state.chosen">
        <span>{{ state.chosen.label }}</span>
        <span class="maps">{{ state.chosen.maps }}</span>
      </p>
      <ul class="warnings" $if="state.chosen && state.chosen.warnings.length">
        <li $for="warning in state.chosen.warnings" $key="warning">{{ warning }}</li>
      </ul>
      <p class="facts" $if="state.mapFiles">
        <span class="maps">Maps from files: <span class="mono">{{ state.mapFiles }}</span></span>
      </p>
      <label class="dialog-field">Output folder
        <input class="well large mono" type="text" spellcheck="false" $model="state.out" />
      </label>
      <p class="hint">A <span class="mono">.theca</span> package: the editor shows it as one asset, and it is an ordinary folder on disk. An earlier build there is replaced.</p>
      <label class="check" title="For scans whose UV layout is many small islands: simplification may then cross seams, stretching the texture a little over them, so the coarse levels can shrink.">
        <input class="checkbox" type="checkbox" $model="state.permissive" /> Simplify across UV seams
      </label>
      <label class="check" title="Groups clusters with meshoptimizer's partitioner and keeps triangles even as they simplify: tidier coarse levels, a little slower to build.">
        <input class="checkbox" type="checkbox" $model="state.partition" /> Compact grouping
      </label>
      <label class="dialog-field" $if="state.chosen && state.chosen.hasMaps">Largest map
        <span class="well large select">
          <select $model="state.maxTexture">
            <option value="4096">4096</option>
            <option value="8192">8192</option>
            <option value="16384">16384</option>
          </select>
        </span>
      </label>
      <label class="check">
        <input class="checkbox" type="checkbox" $model="state.addToScene" /> Add a streamed surface to the scene
      </label>
    </template>

    <div class="running" $if="state.phase === 'running'">
      <div class="stage">
        <span>{{ state.stageLabel }}</span>
        <span class="mono" $if="state.steps > 1">{{ state.step }} of {{ state.steps }}</span>
      </div>
      <progress class="bar" max="100" $value="state.percent"></progress>
      <p class="message mono">{{ state.message }}</p>
    </div>

    <template $if="state.phase === 'done'">
      <p class="summary">{{ state.summary }}</p>
      <ul class="warnings" $if="state.warnings.length">
        <li $for="warning in state.warnings" $key="warning">{{ warning }}</li>
      </ul>
    </template>

    <p class="error" $if="state.error">{{ state.error }}</p>

    <footer class="dialog-actions">
      <template $if="state.phase === 'running'">
        <button class="button large" type="button" @click="cancel()">Cancel</button>
      </template>
      <template $else-if="state.phase === 'choose'">
        <span class="dialog-keys">↵ build · Esc cancel</span>
        <button class="button large" type="button" @click="close()">Cancel</button>
        <button class="button large primary" type="submit" $disabled="!state.chosen || !state.chosen.buildable || !state.out.trim()">{{ state.rebuilding ? 'Rebuild' : 'Build' }}</button>
      </template>
      <template $else>
        <button class="button large primary" type="button" @click="close()">Close</button>
      </template>
    </footer>
  </form>
</div>
</view>

<logic lang="ts">
import { reactive, shared, onMounted } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'
import { STREAMABLE_DEFAULT } from '../cells.ts'
import { MAP_NAMES, type StreamableMesh } from '../converter.ts'

interface MeshRow { index: number; label: string; maps: string; warnings: string[]; buildable: boolean; hasMaps: boolean }

const STAGE_NAMES: Record<string, string> = { clusters: 'Cutting the cluster hierarchy', tiles: 'Tiling the base colour', 'tiles-normal': 'Tiling the normal map', 'tiles-metallicRoughness': 'Tiling metallic-roughness', 'tiles-occlusion': 'Tiling occlusion', 'tiles-orm': 'Tiling occlusion-roughness-metallic' }

const cell = shared('editor:streamable', STREAMABLE_DEFAULT)
const state = reactive({
  open: false,
  phase: 'reading',
  source: '',
  out: '',
  meshes: [] as MeshRow[],
  mesh: '0',
  chosen: null as MeshRow | null,
  permissive: false,
  partition: false,
  maxTexture: '16384',
  addToScene: true,
  stageLabel: '',
  step: 0,
  steps: 0,
  percent: 0,
  message: '',
  error: '',
  warnings: [] as string[],
  summary: '',
  rebuilding: false,
  mapFiles: '',
})

const row = (mesh: StreamableMesh): MeshRow => {
  const triangles = mesh.triangles === null ? '' : ` · ${mesh.triangles.toLocaleString()} triangles`
  return {
    index: mesh.index,
    label: `${mesh.name ?? `mesh ${mesh.index}`}${triangles}`,
    maps: mesh.maps.length ? `Maps: ${mesh.maps.map((m) => MAP_NAMES[m] ?? m).join(', ')}` : 'No maps: geometry only',
    warnings: mesh.warnings,
    buildable: mesh.buildable,
    hasMaps: mesh.maps.length > 0,
  }
}

function picked() {
  state.chosen = state.meshes.find((mesh) => String(mesh.index) === state.mesh) ?? null
}

let shownSource = ''
let shownRebuild: unknown = null
cell.subscribe((next: typeof STREAMABLE_DEFAULT | undefined) => {
  if (!next || !next.open) {
    state.open = false
    shownSource = ''
    return
  }
  // The form keeps what the person typed while the build reports; it is filled afresh for each file.
  if (next.source !== shownSource || (next.phase === 'choose' && state.phase === 'reading')) {
    shownSource = next.source
    state.out = next.out
    state.meshes = next.meshes.map(row)
    state.mesh = String(next.mesh)
    state.permissive = false
    state.partition = false
    state.maxTexture = '16384'
    picked()
  }
  // A rebuild arrives after the file is read: its folder, mesh and options as the theca recorded them.
  if (next.rebuild && next.rebuild !== shownRebuild) {
    shownRebuild = next.rebuild
    state.out = next.out
    state.mesh = String(next.mesh)
    state.permissive = next.rebuild.permissive
    state.partition = next.rebuild.partition
    state.maxTexture = String(next.rebuild.maxTexture)
    picked()
  }
  state.rebuilding = Boolean(next.rebuild)
  state.mapFiles = (next.rebuild?.maps ?? []).map((map) => `${MAP_NAMES[map.role] ?? map.role} ← ${map.path.replace(/^.*\//, '')}`).join(', ')
  state.open = true
  state.phase = next.phase
  state.source = next.source
  state.stageLabel = STAGE_NAMES[next.stage] ?? 'Starting'
  state.step = next.step
  state.steps = next.steps
  state.percent = next.steps ? Math.round((100 * (Math.max(0, next.step - 1) + (next.fraction ?? 0))) / next.steps) : 0
  state.message = next.message
  state.error = next.error
  state.warnings = next.warnings
  state.summary = next.summary
  if (next.phase === 'choose') setTimeout(() => (document.querySelector('#streamable-dialog .primary') as HTMLButtonElement | null)?.focus(), 0)
})

function start(event: Event) {
  event.preventDefault()
  if (state.phase !== 'choose' || !state.chosen?.buildable) return
  sendCommand({
    type: 'streamableStart',
    out: state.out,
    addToScene: state.addToScene,
    options: { mesh: state.chosen.index, permissive: state.permissive, partition: state.partition, quality: 90, maxTexture: Number(state.maxTexture) },
  })
}

function cancel() {
  sendCommand({ type: 'streamableCancel' })
}

function close() {
  if (state.phase === 'running') return
  sendCommand({ type: 'streamableClose' })
}

onMounted(() => {
  document.addEventListener('keydown', (event) => {
    if (state.open && event.key === 'Escape') close()
  })
})
</logic>

<style>
.scrim {
  z-index: 1300;
}

.dialog {
  width: min(34rem, calc(100vw - 2 * var(--cat-space-4)));
}

.lead {
  margin: 0;
  color: var(--cat-text-secondary);
}

.mono {
  font-family: var(--cat-font-mono);
}

.hint {
  margin: 0;
  color: var(--cat-text-tertiary);
}

.facts {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-1);
  margin: 0;
  color: var(--cat-text-primary);
}

.maps {
  color: var(--cat-text-secondary);
}

.warnings {
  margin: 0;
  padding-left: var(--cat-space-4);
  color: var(--cat-warning);
}

.check {
  display: flex;
  align-items: center;
  gap: var(--cat-space-2);
  color: var(--cat-text-secondary);
}

.running {
  display: flex;
  flex-direction: column;
  gap: var(--cat-space-2);
}

.stage {
  display: flex;
  justify-content: space-between;
  gap: var(--cat-space-2);
  color: var(--cat-text-primary);
}

.bar {
  width: 100%;
  height: 6px;
  border: none;
  border-radius: 3px;
  overflow: hidden;
  appearance: none;
  background: var(--cat-bg-field);
}

.bar::-webkit-progress-bar {
  background: var(--cat-bg-field);
}

.bar::-webkit-progress-value {
  background: var(--cat-accent);
  transition: width 0.2s;
}

.bar::-moz-progress-bar {
  background: var(--cat-accent);
}

.message {
  min-height: var(--cat-leading-body);
  margin: 0;
  overflow: hidden;
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary {
  margin: 0;
  color: var(--cat-text-primary);
}

.error {
  margin: 0;
  color: var(--cat-danger);
}
</style>
