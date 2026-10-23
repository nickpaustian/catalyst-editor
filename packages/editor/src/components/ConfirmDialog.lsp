<view>
<div class="backdrop" $if="state.open" @pointerdown="close()">
  <div class="dialog" role="dialog" @pointerdown="$event.stopPropagation()">
    <header class="title">{{ state.title }}</header>
    <p class="message">{{ state.message }}</p>
    <footer class="actions">
      <button $for="action in state.actions" $key="action.key" type="button" $class="{ primary: action.primary }" @click="pick(action)">{{ action.label }}</button>
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
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 1400;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--cat-scrim);
}

.dialog {
  width: min(440px, 92vw);
  display: flex;
  flex-direction: column;
  background: var(--cat-bg-panel);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-md);
  box-shadow: var(--cat-shadow-e2);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / var(--cat-leading-body) var(--cat-font-ui);
}

.title {
  padding: var(--cat-space-2) var(--cat-space-3);
  border-bottom: 1px solid var(--cat-border);
  font-size: var(--cat-text-md);
  font-weight: 600;
}

.message {
  margin: 0;
  padding: var(--cat-space-3);
  color: var(--cat-text-secondary);
  white-space: pre-line;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--cat-space-2);
  padding: var(--cat-space-2) var(--cat-space-3);
  border-top: 1px solid var(--cat-border);
}

button {
  font: inherit;
  color: inherit;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-1) var(--cat-space-3);
  cursor: pointer;
}

button.primary {
  background: var(--cat-accent);
  border-color: var(--cat-accent);
  color: var(--cat-text-on-accent);
  font-weight: 500;
}

button:focus-visible {
  outline: 1px solid var(--cat-accent);
  outline-offset: 1px;
}
</style>
