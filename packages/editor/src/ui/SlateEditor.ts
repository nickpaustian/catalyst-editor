import { Slate, UIElement, uiLayer, type Catalyst, type Node3D } from "@nickpaustian/catalyst"

/** The placement a drag changes: the anchor's offsets and the size. */
export interface UILayout {
  x: number
  y: number
  width: string
  height: string
}

export interface SlateEditorOptions {
  engine: Catalyst
  /** Select a node, as a click in the tree does. */
  select: (node: Node3D) => void
  selected: () => Node3D | null
  /** A drag moved the node; the inspector catches up. */
  changed: (node: UIElement) => void
  /** A drag ended having moved the node: one undo step. */
  commit: (node: UIElement, before: UILayout, after: UILayout) => void
  /** The slate left the tree or the editor was closed from inside. */
  closed: () => void
}

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"]

interface Drag {
  node: UIElement
  handle: Handle | null
  startX: number
  startY: number
  scale: number
  left: number
  top: number
  width: number
  height: number
  parentWidth: number
  parentHeight: number
  extraWidth: number
  extraHeight: number
  before: UILayout
  moved: boolean
}

const layoutOf = (node: UIElement): UILayout => ({ x: node.x, y: node.y, width: node.width, height: node.height })

const applyLayout = (node: UIElement, layout: UILayout): void => {
  node.x = layout.x
  node.y = layout.y
  node.width = layout.width
  node.height = layout.height
}

/** A press this short is a click: it selects without moving. */
const CLICK_SLOP = 3

/**
 * One slate on its own over the viewport: the other slates are hidden and
 * the 3D view is dimmed and takes no input. A click picks the UI node under
 * it, a drag moves an anchored node, and the handles resize; a drag is
 * written back as the anchor's offsets and the node's size, so the layout
 * stays relative to the anchored edge.
 */
export class SlateEditor {
  private readonly options: SlateEditorOptions
  private _slate: Slate | null = null
  private dim: HTMLElement | null = null
  private overlay: HTMLElement | null = null
  private frame: HTMLElement | null = null
  private hoverBox: HTMLElement | null = null
  private selectionBox: HTMLElement | null = null
  private drag: Drag | null = null
  private hovered: UIElement | null = null
  private loop = 0

  constructor(options: SlateEditorOptions) {
    this.options = options
  }

  get slate(): Slate | null {
    return this._slate
  }

  open(slate: Slate): void {
    if (this._slate === slate) return
    this.close()
    const container = this.options.engine.container
    const layer = uiLayer(this.options.engine)
    if (!container || !layer) return
    this._slate = slate
    layer.dataset.editing = ""
    slate.host.dataset.edited = ""
    this.dim = el("div", "slate-editor-dim")
    container.insertBefore(this.dim, layer)
    this.overlay = el("div", "slate-editor")
    this.frame = el("div", "slate-editor-frame")
    this.hoverBox = el("div", "slate-editor-hover")
    this.selectionBox = el("div", "slate-editor-selection")
    for (const handle of HANDLES) {
      const knob = el("div", `slate-editor-handle ${handle}`)
      knob.dataset.handle = handle
      this.selectionBox.append(knob)
    }
    const bar = el("div", "slate-editor-bar")
    const title = el("span", "slate-editor-title")
    title.textContent = `Editing ${slate.name}`
    const done = el("button", "slate-editor-done") as HTMLButtonElement
    done.type = "button"
    done.textContent = "Done"
    done.title = "Back to the scene (Esc)"
    done.addEventListener("click", () => this.closeFromInside())
    bar.append(title, done)
    this.overlay.append(this.frame, this.hoverBox, this.selectionBox, bar)
    container.append(this.overlay)
    this.overlay.addEventListener("pointerdown", this.onDown)
    this.overlay.addEventListener("pointermove", this.onHover)
    this.overlay.addEventListener("pointerleave", () => (this.hovered = null))
    const tick = () => {
      this.draw()
      this.loop = requestAnimationFrame(tick)
    }
    this.loop = requestAnimationFrame(tick)
  }

  close(): void {
    const slate = this._slate
    if (!slate) return
    this.endDrag()
    cancelAnimationFrame(this.loop)
    const layer = uiLayer(this.options.engine)
    if (layer) delete layer.dataset.editing
    delete slate.host.dataset.edited
    this.dim?.remove()
    this.overlay?.remove()
    this.dim = this.overlay = this.frame = this.hoverBox = this.selectionBox = null
    this.hovered = null
    this._slate = null
  }

  private closeFromInside(): void {
    this.close()
    this.options.closed()
  }

  /** The UI nodes on the slate under a page point, topmost first: later in the tree draws over earlier, and a child over its parent. */
  private nodesAt(x: number, y: number): UIElement[] {
    const found: UIElement[] = []
    this._slate?.walk((node) => {
      if (!(node instanceof UIElement)) return
      if (!node.isVisible) return false
      const r = node.element.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) found.push(node)
    })
    return found.reverse()
  }

  private selectedElement(): UIElement | null {
    const node = this.options.selected()
    return node instanceof UIElement && node.slate === this._slate ? node : null
  }

  private readonly onHover = (event: PointerEvent): void => {
    if (this.drag) return
    this.hovered = this.nodesAt(event.clientX, event.clientY)[0] ?? null
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this._slate || !this.overlay) return
    const target = event.target as HTMLElement
    if (target.closest(".slate-editor-bar")) return
    event.preventDefault()
    const handle = (target.dataset.handle as Handle | undefined) ?? null
    let node = this.selectedElement()
    if (!handle) {
      const hit = this.nodesAt(event.clientX, event.clientY)[0] ?? null
      if (hit !== node || !hit) this.options.select(hit ?? this._slate)
      node = hit
    }
    if (!node || node.anchor === "fill" || (!handle && node.anchor === "flow")) return
    this.startDrag(node, handle, event)
  }

  private startDrag(node: UIElement, handle: Handle | null, event: PointerEvent): void {
    const element = node.element
    const parent = element.parentElement
    if (!parent || !this.overlay) return
    const parentRect = parent.getBoundingClientRect()
    const scale = parent.offsetWidth > 0 ? parentRect.width / parent.offsetWidth : 1
    const originX = parentRect.left + parent.clientLeft * scale
    const originY = parentRect.top + parent.clientTop * scale
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const sum = (...values: string[]) => (style.boxSizing === "border-box" ? 0 : values.reduce((total, value) => total + (parseFloat(value) || 0), 0))
    this.drag = {
      node,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      scale,
      left: (rect.left - originX) / scale,
      top: (rect.top - originY) / scale,
      width: rect.width / scale,
      height: rect.height / scale,
      parentWidth: parent.clientWidth,
      parentHeight: parent.clientHeight,
      extraWidth: sum(style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth),
      extraHeight: sum(style.paddingTop, style.paddingBottom, style.borderTopWidth, style.borderBottomWidth),
      before: layoutOf(node),
      moved: false,
    }
    this.overlay.setPointerCapture(event.pointerId)
    this.overlay.addEventListener("pointermove", this.onDrag)
    this.overlay.addEventListener("pointerup", this.onUp)
    this.overlay.addEventListener("pointercancel", this.onUp)
  }

  private readonly onDrag = (event: PointerEvent): void => {
    const drag = this.drag
    if (!drag) return
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < CLICK_SLOP) return
    drag.moved = true
    const dx = (event.clientX - drag.startX) / drag.scale
    const dy = (event.clientY - drag.startY) / drag.scale
    let { left, top, width, height } = drag
    const handle = drag.handle
    if (!handle) {
      left += dx
      top += dy
    } else {
      if (handle.includes("e")) width = Math.max(1, width + dx)
      if (handle.includes("w")) {
        const next = Math.max(1, width - dx)
        left += width - next
        width = next
      }
      if (handle.includes("s")) height = Math.max(1, height + dy)
      if (handle.includes("n")) {
        const next = Math.max(1, height - dy)
        top += height - next
        height = next
      }
    }
    const node = drag.node
    const layout = this.layoutFor(node, drag, Math.round(left), Math.round(top), Math.round(width), Math.round(height))
    applyLayout(node, layout)
    this.options.changed(node)
  }

  /** A rect in the parent's own pixels as the anchor's offsets: from the anchored edge, or from the centre. Only a resize writes the size. */
  private layoutFor(node: UIElement, drag: Drag, left: number, top: number, width: number, height: number): UILayout {
    const anchor = node.anchor
    const resized = drag.handle !== null
    const layout: UILayout = {
      x: node.x,
      y: node.y,
      width: resized && drag.handle!.match(/[ew]/) ? String(Math.max(1, width - drag.extraWidth)) : drag.before.width,
      height: resized && drag.handle!.match(/[ns]/) ? String(Math.max(1, height - drag.extraHeight)) : drag.before.height,
    }
    if (anchor === "flow") return layout
    const horizontal = anchor.endsWith("left") ? "left" : anchor.endsWith("right") ? "right" : "centre"
    const vertical = anchor.startsWith("top") ? "top" : anchor.startsWith("bottom") ? "bottom" : "centre"
    layout.x = horizontal === "left" ? left : horizontal === "right" ? drag.parentWidth - (left + width) : Math.round(left + width / 2 - drag.parentWidth / 2)
    layout.y = vertical === "top" ? top : vertical === "bottom" ? drag.parentHeight - (top + height) : Math.round(top + height / 2 - drag.parentHeight / 2)
    return layout
  }

  private readonly onUp = (): void => {
    const drag = this.drag
    this.endDrag()
    if (!drag?.moved) return
    const after = layoutOf(drag.node)
    if (JSON.stringify(after) !== JSON.stringify(drag.before)) this.options.commit(drag.node, drag.before, after)
  }

  private endDrag(): void {
    this.drag = null
    this.overlay?.removeEventListener("pointermove", this.onDrag)
    this.overlay?.removeEventListener("pointerup", this.onUp)
    this.overlay?.removeEventListener("pointercancel", this.onUp)
  }

  private draw(): void {
    const slate = this._slate
    if (!slate || !this.overlay) return
    if (!slate.isInTree) return this.closeFromInside()
    const origin = this.overlay.getBoundingClientRect()
    place(this.frame, slate.size === "design" && slate.space === "screen" ? slate.content.getBoundingClientRect() : null, origin)
    const selected = this.selectedElement()
    const hovered = this.hovered && this.hovered !== selected && this.hovered.isInTree ? this.hovered : null
    place(this.hoverBox, hovered ? hovered.element.getBoundingClientRect() : null, origin)
    place(this.selectionBox, selected?.isVisible ? selected.element.getBoundingClientRect() : null, origin)
    if (this.selectionBox) {
      this.selectionBox.dataset.anchor = selected?.anchor ?? ""
      this.selectionBox.classList.toggle("dragging", this.drag !== null)
    }
  }
}

const el = (tag: string, className: string): HTMLElement => {
  const element = document.createElement(tag)
  element.className = className
  return element
}

const place = (box: HTMLElement | null, rect: DOMRect | null, origin: DOMRect): void => {
  if (!box) return
  box.hidden = !rect
  if (!rect) return
  Object.assign(box.style, { left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })
}
