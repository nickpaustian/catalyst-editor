<view>
<div class="catalogue" $class="{ open: shared['catalogue:open'] }">
  <button class="reopen" type="button" $show="!shared['catalogue:open'] && shared['catalogue:current']" @click="open">
    Exhibitions
  </button>

  <div class="sheet" $show="shared['catalogue:open']">
    <h1 class="heading">Exhibitions</h1>
    <ul class="list">
      <li class="entry" $for="entry in shared['catalogue:entries']" $key="entry.id">
        <button class="pick" type="button" $class="{ current: entry.id === shared['catalogue:current'] }" @click="pick(entry)">
          <span class="title">{{ entry.title }}</span>
          <span class="description" $show="entry.description">{{ entry.description }}</span>
        </button>
      </li>
    </ul>
    <button class="close" type="button" $show="shared['catalogue:current']" @click="close">Back to the exhibition</button>
  </div>
</div>
</view>

<logic lang="ts">
import { shared } from '@lightspeed-js/core'

const entries = shared('catalogue:entries', [])
const current = shared('catalogue:current', null)
const isOpen = shared('catalogue:open', true)
// The host listens here: each pick is a new object so the same choice twice still arrives
const choice = shared('catalogue:choice', null)

function pick(entry: { id: string }) {
  choice.set({ id: entry.id, at: Date.now() })
}

function open() {
  isOpen.set(true)
}

function close() {
  isOpen.set(false)
}
</logic>

<style>
.catalogue {
  position: fixed;
  inset: 0;
  z-index: 900;
  pointer-events: none;
  font-family: "IBM Plex Sans", system-ui, sans-serif;
  color: #fbf5ee;
}

.reopen,
.close,
.pick {
  pointer-events: auto;
  font: inherit;
  color: inherit;
  cursor: pointer;
}

.reopen {
  position: absolute;
  top: 16px;
  right: 16px;
  padding: 8px 14px;
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(251, 245, 238, 0.4);
  border-radius: 999px;
  font-size: 13px;
  letter-spacing: 0.04em;
}

.sheet {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 32px 16px;
  background: rgba(0, 0, 0, 0.88);
  pointer-events: auto;
}

.heading {
  margin: 0;
  font-size: 14px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #bfb6ac;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 12px;
  width: min(480px, 100%);
}

.pick {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 20px;
  background: rgba(251, 245, 238, 0.06);
  border: 1px solid rgba(251, 245, 238, 0.18);
  border-radius: 10px;
  text-align: left;
}

.pick.current {
  border-color: #f79d32;
}

.title {
  font-size: 22px;
  font-weight: 500;
}

.description {
  font-size: 14px;
  color: #bfb6ac;
}

.close {
  padding: 10px 18px;
  background: none;
  border: 1px solid rgba(251, 245, 238, 0.4);
  border-radius: 999px;
  font-size: 13px;
}
</style>

<style deferred>
.pick:hover {
  background: rgba(251, 245, 238, 0.12);
}

.reopen:hover,
.close:hover {
  border-color: #fbf5ee;
}
</style>
