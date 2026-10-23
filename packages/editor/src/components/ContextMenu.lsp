<view>
<div class="menu" $if="state.open" @pointerdown="$event.stopPropagation()" @contextmenu="$event.preventDefault()">
  <template $for="item in state.items" $key="item.key">
    <hr $if="item.separator" />
    <button $else type="button" $disabled="item.disabled" @click="pick(item)">
      <span class="label">{{ item.label }}</span>
      <kbd $if="item.kbd">{{ item.kbd }}</kbd>
    </button>
  </template>
</div>
</view>

<logic lang="ts">
import { reactive, shared, onMounted } from '@lightspeed-js/core'

interface Item { key: number; separator: boolean; label: string; disabled: boolean; kbd: string; run: (() => void) | null }

const cell = shared('editor:contextMenu', null)
const state = reactive({ open: false, x: 0, y: 0, items: [] as Item[] })

function close() {
  if (cell.value) cell.set(null)
}

function pick(item: Item) {
  close()
  item.run?.()
}

cell.subscribe((next: { x: number; y: number; items: any[] } | null | undefined) => {
  if (!next) {
    state.open = false
    state.items = []
    return
  }
  state.items = next.items.map((item, key) => ({ key, separator: Boolean(item.separator), label: item.label ?? '', disabled: Boolean(item.disabled), kbd: item.kbd ?? '', run: item.run ?? null }))
  state.x = next.x
  state.y = next.y
  state.open = true
  placeWhenRendered(++opening)
})

let opening = 0

// The element appears with the render, a frame or two after the state
// changes, so placement waits for it (and gives up if the menu closed first)
function placeWhenRendered(id: number, tries = 0) {
  if (id !== opening || !state.open) return
  const menu = document.querySelector<HTMLElement>('#context-menu .menu')
  if (menu) return place(menu)
  if (tries < 90) requestAnimationFrame(() => placeWhenRendered(id, tries + 1))
}

// At the pointer, shifted back inside the window when it would not fit
function place(menu: HTMLElement) {
  menu.style.left = `${state.x}px`
  menu.style.top = `${state.y}px`
  const rect = menu.getBoundingClientRect()
  const x = rect.right > window.innerWidth ? Math.max(0, window.innerWidth - rect.width - 4) : state.x
  const y = rect.bottom > window.innerHeight ? Math.max(0, window.innerHeight - rect.height - 4) : state.y
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
  menu.classList.add('placed')
}

onMounted(() => {
  document.addEventListener('pointerdown', close, true)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close()
  })
  window.addEventListener('blur', close)
  window.addEventListener('resize', close)
})
</logic>

<style>
.menu {
  position: fixed;
  z-index: 2500;
  visibility: hidden;
}

.menu.placed {
  visibility: visible;
}

.menu {
  min-width: 180px;
  padding: var(--cat-space-1);
  background: var(--cat-bg-raised);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-md);
  box-shadow: var(--cat-shadow-e1);
  color: var(--cat-text-primary);
  font: var(--cat-text-sm) / var(--cat-leading-body) var(--cat-font-ui);
  user-select: none;
}

button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--cat-space-4);
  width: 100%;
  padding: var(--cat-space-1) var(--cat-space-2);
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  border-radius: var(--cat-radius-sm);
  text-align: left;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: var(--cat-bg-hover);
}

button:disabled {
  color: var(--cat-text-disabled);
  cursor: default;
}

kbd {
  font: var(--cat-text-xs) var(--cat-font-mono);
  color: var(--cat-text-tertiary);
}

hr {
  margin: var(--cat-space-1) var(--cat-space-1-5);
  border: 0;
  border-top: 1px solid var(--cat-border);
}
</style>
