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
  background: rgba(0, 0, 0, 0.55);
}

.dialog {
  width: min(440px, 92vw);
  display: flex;
  flex-direction: column;
  background: #161616;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
  color: #ddd;
  font: 12px/1.4 "IBM Plex Sans", system-ui, sans-serif;
}

.title {
  padding: 8px 12px;
  border-bottom: 1px solid #2a2a2a;
  font-size: 13px;
  font-weight: 600;
}

.message {
  margin: 0;
  padding: 12px;
  color: #bbb;
  white-space: pre-line;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #2a2a2a;
}

button {
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 5px 14px;
  cursor: pointer;
}

button.primary {
  background: #3b5aa0;
  border-color: #6a8fd8;
  color: #fff;
}

button:focus-visible {
  outline: 1px solid #6a8fd8;
  outline-offset: 1px;
}
</style>
