export interface Scrub {
  read: () => number
  write: (value: number) => void
  step: number
  min?: number
  max?: number
  /** Focused instead when the handle is clicked without a drag. */
  input?: HTMLInputElement | null
}

const DRAG_THRESHOLD = 3

/**
 * Drag a handle (a property's label, a vector's axis letter) sideways to
 * slide its value; shift scrubs ten times faster, alt ten times finer. A
 * plain click focuses the input for typing.
 */
export function scrub(event: PointerEvent, { read, write, step, min, max, input }: Scrub): void {
  if (event.button !== 0) return
  event.preventDefault()

  const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1)
  const startX = event.clientX
  let lastX = startX
  let value = Number(read()) || 0
  let dragging = false

  const move = (e: PointerEvent) => {
    if (!dragging) {
      if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD) return
      dragging = true
      lastX = e.clientX
      document.body.classList.add("scrubbing")
    }
    const scale = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
    value += (e.clientX - lastX) * step * scale
    lastX = e.clientX
    if (min !== undefined) value = Math.max(min, value)
    if (max !== undefined) value = Math.min(max, value)
    write(Number(value.toFixed(decimals)))
  }

  const end = () => {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", end)
    window.removeEventListener("pointercancel", end)
    if (dragging) document.body.classList.remove("scrubbing")
    else {
      input?.focus()
      input?.select()
    }
  }

  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", end)
  window.addEventListener("pointercancel", end)
}
