<view>
<div class="scrim" $if="state.open" @pointerdown="close()">
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" @pointerdown="$event.stopPropagation()">
    <h2 class="dialog-title" id="confirm-title">{{ state.title }}</h2>
    <p class="message">{{ state.message }}</p>
    <footer class="dialog-actions">
      <button $for="action in state.actions" $key="action.key" type="button" class="button large" $class="{ primary: action.primary }" @click="pick(action)">{{ action.label }}</button>
    </footer>
  </div>
</div>
</view>

<logic lang="ts">
import { reactive, shared, onMounted } from '@lightspeed-js/core'

interface Action { key: number; label: string; primary: boolean; run: () => void }

const cell = shared('editor:confirm', null)
const state = reactive({ open: false, title: '', message: '', actions: [] as Action[] })

function close() {
  if (cell.value) cell.set(null)
}

function pick(action: Action) {
  close()
  action.run()
}

cell.subscribe((next: { title: string; message: string; actions: any[] } | null | undefined) => {
  if (!next) {
    state.open = false
    state.actions = []
    return
  }
  state.title = next.title
  state.message = next.message
  state.actions = next.actions.map((action, key) => ({ key, label: action.label ?? '', primary: Boolean(action.primary), run: action.run }))
  state.open = true
  setTimeout(() => (document.querySelector('#confirm-dialog .primary, #confirm-dialog button') as HTMLButtonElement | null)?.focus(), 0)
})

onMounted(() => {
  document.addEventListener('keydown', (event) => {
    if (!state.open) return
    if (event.key === 'Escape') close()
    if (event.key === 'Enter') {
      const primary = state.actions.find((action) => action.primary)
      if (primary) {
        event.preventDefault()
        pick(primary)
      }
    }
  })
})
</logic>

<style>
.scrim {
  z-index: 1400;
}

.message {
  margin: 0;
  color: var(--cat-text-secondary);
  white-space: pre-line;
}
</style>
