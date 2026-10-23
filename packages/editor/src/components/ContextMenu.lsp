<view>
<div class="menu" $if="state.open" $ref="menu" $style="{ left: state.x + 'px', top: state.y + 'px' }" @pointerdown="$event.stopPropagation()" @contextmenu="$event.preventDefault()">
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
import { reactive, shared, defineRefs, onMounted } from '@lightspeed-js/core'

interface Item { key: number; separator: boolean; label: string; disabled: boolean; kbd: string; run: (() => void) | null }

const cell = shared('editor:contextMenu', null)
const refs = defineRefs<{ menu: HTMLElement }>()
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
  // Keep the menu inside the window once it has a size
  setTimeout(() => {
    const menu = refs.menu
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    if (rect.right > window.innerWidth) state.x = Math.max(0, window.innerWidth - rect.width - 4)
    if (rect.bottom > window.innerHeight) state.y = Math.max(0, window.innerHeight - rect.height - 4)
  }, 0)
})

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
  min-width: 180px;
  padding: 4px;
  background: #1c1c1c;
  border: 1px solid #3a3a3a;
  border-radius: 5px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
  color: #ddd;
  font: 12px/1.4 "IBM Plex Sans", system-ui, sans-serif;
  user-select: none;
}

button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  padding: 5px 10px;
  font: inherit;
  color: inherit;
  background: none;
  border: 0;
  border-radius: 3px;
  text-align: left;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: #2a3650;
}

button:disabled {
  color: #666;
  cursor: default;
}

kbd {
  font: 10px ui-monospace, Menlo, monospace;
  color: #999;
}

hr {
  margin: 4px 6px;
  border: 0;
  border-top: 1px solid #333;
}
</style>
