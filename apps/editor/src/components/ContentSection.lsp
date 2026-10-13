<view>
<section class="content">
  <h2>Content</h2>
  <div class="list">
    <div
      class="item"
      $for="entry in shared['editor:content'].entries"
      $key="entry.id"
      $class="{ selected: entry.selected, edited: entry.edited }"
      @click="select(entry)"
    >{{ entry.id }}</div>
  </div>
  <div class="row">
    <input type="text" placeholder="new content id" $model="state.newId" />
    <button @click="add">Add</button>
  </div>
  <template $if="shared['editor:content'].selectedId">
    <p class="hint">{{ shared['editor:content'].selectedId }}</p>
    <textarea rows="10" spellcheck="false" $model="state.html" @change="setHtml"></textarea>
    <div class="buttons">
      <button @click="send('contentPreview')">Preview</button>
      <button @click="send('contentDelete')">Delete content</button>
    </div>
  </template>
  <p class="hint">A point of interest picks content by id. Edits are kept until saved.</p>
</section>
</view>

<logic lang="ts">
import { reactive, shared } from '@lightspeed-js/core'
import { sendCommand } from '../commands.ts'

const content = shared('editor:content', { entries: [], selectedId: null, html: '' })

// The textarea holds a local copy: a $value binding on a textarea sets an
// attribute the element ignores, and typing must not fight the cell
const state = reactive({ newId: '', html: '' })

content.subscribe((next: any) => {
  state.html = next?.html ?? ''
})

function send(type: string) {
  sendCommand({ type })
}

function select(entry: { id: string }) {
  sendCommand({ type: 'contentSelect', id: entry.id })
}

function add() {
  if (!state.newId) return
  sendCommand({ type: 'contentAdd', id: state.newId })
  state.newId = ''
}

function setHtml() {
  sendCommand({ type: 'contentSetHtml', html: state.html })
}
</logic>

<style>
h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #999;
  margin: 14px 0 4px;
}

.list {
  max-height: 120px;
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

.item.edited::after {
  content: " •";
  color: #ffd54a;
}

.row {
  display: flex;
  gap: 4px;
  margin: 4px 0;
}

input,
textarea,
button {
  font: inherit;
  color: inherit;
  background: #222;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 6px;
}

input {
  flex: 1;
}

textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  resize: vertical;
}

button {
  cursor: pointer;
  margin: 0 4px 4px 0;
}

.hint {
  color: #888;
  font-size: 11px;
  margin: 4px 0;
}
</style>
