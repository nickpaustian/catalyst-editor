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
  font-size: var(--cat-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--cat-text-secondary);
  margin: var(--cat-space-3) 0 var(--cat-space-1);
}

.list {
  max-height: 120px;
  overflow-y: auto;
  border: 1px solid var(--cat-border);
  margin-bottom: var(--cat-space-1-5);
}

.item {
  padding: var(--cat-space-0-5) var(--cat-space-1-5);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item:hover {
  background: var(--cat-bg-hover);
}

.item.selected {
  background: var(--cat-accent-soft);
}

.item.edited::after {
  content: " •";
  color: var(--cat-changed);
}

.row {
  display: flex;
  gap: var(--cat-space-1);
  margin: var(--cat-space-1) 0;
}

input,
textarea,
button {
  font: inherit;
  color: inherit;
  background: var(--cat-bg-field);
  border: 1px solid var(--cat-border);
  border-radius: var(--cat-radius-sm);
  padding: var(--cat-space-0-5) var(--cat-space-1-5);
}

input {
  flex: 1;
}

textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--cat-font-mono);
  font-size: var(--cat-text-xs);
  resize: vertical;
}

button {
  cursor: pointer;
  margin: 0 var(--cat-space-1) var(--cat-space-1) 0;
}

.hint {
  color: var(--cat-text-tertiary);
  font-size: var(--cat-text-xs);
  margin: var(--cat-space-1) 0;
}
</style>
