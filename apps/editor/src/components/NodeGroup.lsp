<view>
<section class="group">
  <h2 class="heading">
    {{ props.group.key }}
    <button class="add" @click="add">+</button>
  </h2>
  <div class="list">
    <div
      class="item"
      $for="node in props.group.nodes"
      $key="node.name"
      $class="{ selected: node.selected }"
      @click="select(node)"
    >{{ node.name }}</div>
  </div>
</section>
</view>

<logic lang="ts">
import { defineProps } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

const props = defineProps({
  group: { default: { key: '', nodes: [] } },
})

function add() {
  sendCommand({ type: 'add', group: props.group.key })
}

function select(node: { name: string }) {
  sendCommand({ type: 'select', group: props.group.key, name: node.name })
}
</logic>

<style>
.heading {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #999;
  margin: 14px 0 4px;
}

.add {
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 0 6px;
  margin-left: 6px;
  cursor: pointer;
}

.list {
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid #333;
  margin-bottom: 6px;
}

.item {
  padding: 2px 6px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item:hover {
  background: #2a2a2a;
}

.item.selected {
  background: #3a4a6a;
}
</style>
