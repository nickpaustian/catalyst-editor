<view>
<div class="menu menu-panel" role="menu" $if="state.open" @pointerdown="$event.stopPropagation()" @contextmenu="$event.preventDefault()">
  <template $for="item in state.items" $key="item.key">
    <hr $if="item.separator" />
    <button $else class="menu-item" type="button" role="menuitem" $class="{ danger: item.danger }" $disabled="item.disabled" @click="pick(item)">
      <span class="label">{{ item.label }}</span>
      <kbd $if="item.kbd">{{ item.kbd }}</kbd>
    </button>
  </template>
</div>
</view>

<logic lang="ts">
import { reactive, shared, onMounted } from '@lightspeed-js/core'

interface Item { key: number; separator: boolean; label: string; disabled: boolean; danger: boolean; kbd: string; run: (() => void) | null }

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
  state.items = next.items.map((item, key) => ({ key, separator: Boolean(item.separator), label: item.label ?? '', disabled: Boolean(item.disabled), danger: Boolean(item.danger), kbd: item.kbd ?? '', run: item.run ?? null }))
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

.label {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
