import {
  MIN_SIZE,
  findLeaf,
  leaves,
  movePane,
  pane,
  removePane,
  resize,
  insertBeside,
  type DropZone,
  type LayoutNode,
  type PaneKind,
  type PaneSplit,
} from "./layout"

export interface PaneContent {
  title: string
  /** The element shown in the pane. One per kind: a kind can be open in one pane at a time. */
  element: HTMLElement
}

export interface PaneLayoutOptions {
  root: HTMLElement
  kinds: Record<PaneKind, PaneContent>
  layout: LayoutNode
  onChange: (layout: LayoutNode) => void
}

const DRAG_THRESHOLD = 4
const EDGE_FRACTION = 0.3

/**
 * A tree of resizable, rearrangeable panes. Each pane shows one kind of
 * content, an element the layout adopts (moves) into the pane's body, so the
 * WebGL canvas and the Lightspeed panel keep their state when the tree changes.
 */
export class PaneLayout {
  private readonly root: HTMLElement
  private readonly kinds: Record<PaneKind, PaneContent>
  private readonly onChange: (layout: LayoutNode) => void
  private readonly parked = document.createElement("div")
  private _layout: LayoutNode
  private openMenu: HTMLElement | null = null

  constructor(options: PaneLayoutOptions) {
    this.root = options.root
    this.kinds = options.kinds
    this.onChange = options.onChange
    this._layout = options.layout
    this.root.classList.add("pane-root")
    this.parked.className = "pane-parked"
    this.parked.hidden = true
    document.body.appendChild(this.parked)
    document.addEventListener("pointerdown", this.closeMenuOnOutsideClick, true)
    this.render()
  }

  public get layout(): LayoutNode {
    return this._layout
  }

  public set layout(layout: LayoutNode) {
    this._layout = layout
    this.render()
    this.onChange(layout)
  }

  /** The body element currently showing a kind, if it is open. */
  public bodyOf(kind: PaneKind): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`.pane-body[data-kind="${kind}"]`)
  }

  public dispose(): void {
    document.removeEventListener("pointerdown", this.closeMenuOnOutsideClick, true)
    this.parked.remove()
  }

  // ---------------- rendering ----------------

  private render(): void {
    this.closeMenu()
    for (const content of Object.values(this.kinds)) this.parked.appendChild(content.element)
    this.root.replaceChildren(this.build(this._layout))
  }

  private build(node: LayoutNode): HTMLElement {
    if (node.type === "pane") return this.buildPane(node.id, node.kind)

    const element = document.createElement("div")
    element.className = `pane-split ${node.direction}`
    element.dataset.id = node.id
    node.children.forEach((child, index) => {
      if (index > 0) element.appendChild(this.buildGutter(node, index))
      const childElement = this.build(child)
      childElement.style.flexGrow = String(node.sizes[index])
      element.appendChild(childElement)
    })
    return element
  }

  private buildPane(id: string, kind: PaneKind): HTMLElement {
    const content = this.kinds[kind]
    const element = document.createElement("div")
    element.className = "pane"
    element.dataset.id = id

    const header = document.createElement("div")
    header.className = "pane-header"
    header.addEventListener("pointerdown", (event) => this.startPaneDrag(event, id))

    const title = document.createElement("span")
    title.className = "pane-title"
    title.textContent = content.title

    const actions = document.createElement("span")
    actions.className = "pane-actions"
    const add = document.createElement("button")
    add.type = "button"
    add.textContent = "+"
    add.title = "Add a pane beside this one"
    add.addEventListener("click", (event) => this.toggleMenu(event.currentTarget as HTMLElement, id))
    const close = document.createElement("button")
    close.type = "button"
    close.textContent = "×"
    close.title = "Close this pane"
    close.disabled = leaves(this._layout).length <= 1
    close.addEventListener("click", () => this.closePane(id))
    actions.append(add, close)

    header.append(title, actions)

    const body = document.createElement("div")
    body.className = `pane-body ${kind}`
    body.dataset.kind = kind
    body.appendChild(content.element)

    element.append(header, body)
    return element
  }

  private buildGutter(split: PaneSplit, index: number): HTMLElement {
    const gutter = document.createElement("div")
    gutter.className = "pane-gutter"
    gutter.addEventListener("pointerdown", (event) => this.startGutterDrag(event, split.id, index))
    return gutter
  }

  // ---------------- resizing ----------------

  private startGutterDrag(event: PointerEvent, splitId: string, index: number): void {
    event.preventDefault()
    const gutter = event.currentTarget as HTMLElement
    const splitElement = gutter.parentElement!
    const horizontal = splitElement.classList.contains("row")
    const children = [...splitElement.children].filter((child) =>
      child.classList.contains("pane") || child.classList.contains("pane-split"),
    ) as HTMLElement[]
    const before = children[index - 1]
    const after = children[index]
    const sizes = children.map((child) => parseFloat(child.style.flexGrow) || 0)
    const rect = splitElement.getBoundingClientRect()
    const span = horizontal ? rect.width : rect.height
    const start = horizontal ? event.clientX : event.clientY
    const pair = sizes[index - 1] + sizes[index]

    document.body.classList.add(horizontal ? "pane-resizing-x" : "pane-resizing-y")
    const move = (moveEvent: PointerEvent) => {
      const delta = ((horizontal ? moveEvent.clientX : moveEvent.clientY) - start) / span
      const first = Math.min(pair - MIN_SIZE, Math.max(MIN_SIZE, sizes[index - 1] + delta))
      before.style.flexGrow = String(first)
      after.style.flexGrow = String(pair - first)
    }
    const stop = () => {
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", stop)
      document.body.classList.remove("pane-resizing-x", "pane-resizing-y")
      const final = children.map((child) => parseFloat(child.style.flexGrow) || 0)
      this._layout = resize(this._layout, splitId, final)
      this.onChange(this._layout)
    }
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", stop)
  }

  // ---------------- drag and drop ----------------

  private startPaneDrag(event: PointerEvent, id: string): void {
    if ((event.target as HTMLElement).closest("button")) return
    if (leaves(this._layout).length <= 1) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    let dragging = false
    let target: { id: string; zone: DropZone } | null = null
    let highlight: HTMLElement | null = null

    const clearHighlight = () => {
      highlight?.remove()
      highlight = null
    }

    const move = (moveEvent: PointerEvent) => {
      if (!dragging) {
        if (
          Math.abs(moveEvent.clientX - startX) < DRAG_THRESHOLD &&
          Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD
        )
          return
        dragging = true
        document.body.classList.add("pane-dragging")
      }
      const under = document
        .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
        ?.closest<HTMLElement>(".pane")
      if (!under || under.dataset.id === id) {
        clearHighlight()
        target = null
        return
      }
      const zone = this.zoneAt(under, moveEvent.clientX, moveEvent.clientY)
      if (!target || target.id !== under.dataset.id || target.zone !== zone) {
        clearHighlight()
        target = { id: under.dataset.id!, zone }
        highlight = document.createElement("div")
        highlight.className = `pane-drop ${zone}`
        under.appendChild(highlight)
      }
    }
    const stop = () => {
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", stop)
      document.body.classList.remove("pane-dragging")
      clearHighlight()
      if (dragging && target) {
        this.layout = movePane(this._layout, id, target.id, target.zone)
      }
    }
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", stop)
  }

  private zoneAt(element: HTMLElement, x: number, y: number): DropZone {
    const rect = element.getBoundingClientRect()
    const fx = (x - rect.left) / rect.width
    const fy = (y - rect.top) / rect.height
    const edges: Array<[DropZone, number]> = [
      ["left", fx],
      ["right", 1 - fx],
      ["top", fy],
      ["bottom", 1 - fy],
    ]
    const [zone, distance] = edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best))
    return distance < EDGE_FRACTION ? zone : "centre"
  }

  // ---------------- add / close ----------------

  private closePane(id: string): void {
    const next = removePane(this._layout, id)
    if (next) this.layout = next
  }

  private addBeside(id: string, kind: PaneKind): void {
    this.layout = insertBeside(this._layout, id, "right", pane(kind))
  }

  private toggleMenu(anchor: HTMLElement, id: string): void {
    if (this.openMenu) {
      this.closeMenu()
      return
    }
    const open = new Set(leaves(this._layout).map((leaf) => leaf.kind))
    const menu = document.createElement("div")
    menu.className = "pane-menu"
    for (const [kind, content] of Object.entries(this.kinds)) {
      if (open.has(kind)) continue
      const item = document.createElement("button")
      item.type = "button"
      item.textContent = content.title
      item.addEventListener("click", () => this.addBeside(id, kind))
      menu.appendChild(item)
    }
    if (!menu.childElementCount) {
      const note = document.createElement("span")
      note.className = "pane-menu-note"
      note.textContent = "Every pane is open"
      menu.appendChild(note)
    }
    anchor.parentElement!.appendChild(menu)
    this.openMenu = menu
  }

  private closeMenu(): void {
    this.openMenu?.remove()
    this.openMenu = null
  }

  private closeMenuOnOutsideClick = (event: PointerEvent): void => {
    if (this.openMenu && !this.openMenu.contains(event.target as Node)) {
      const inActions = (event.target as HTMLElement).closest(".pane-actions")
      if (!inActions || !inActions.contains(this.openMenu)) this.closeMenu()
    }
  }
}

export { findLeaf }
