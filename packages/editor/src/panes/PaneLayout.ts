import {
  MIN_SIZE,
  activate,
  addTabs,
  detachKind,
  findLeaf,
  leafOf,
  leaves,
  movePane,
  pane,
  resize,
  insertBeside,
  type DropZone,
  type LayoutNode,
  type PaneKind,
  type PaneLeaf,
  type PaneSplit,
} from "./layout"

export interface PaneContent {
  title: string
  /** The element shown in the pane. One per kind: a kind can be open in one pane, as one tab, at a time. */
  element: HTMLElement
  /** Icon buttons in the pane's header, before its options menu. */
  actions?: PaneAction[]
}

export interface PaneAction {
  /** Names the button for screen readers and its tooltip; put the shortcut here too. */
  label: string
  /** Inline SVG markup, drawn at 16px in currentColor. */
  icon: string
  run: () => void
}

export interface PaneLayoutOptions {
  root: HTMLElement
  kinds: Record<PaneKind, PaneContent>
  layout: LayoutNode
  onChange: (layout: LayoutNode) => void
}

const MORE_ICON = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="12.5" cy="8" r="1.25"/></svg>`

const DRAG_THRESHOLD = 4
const EDGE_FRACTION = 0.3

/**
 * A tree of resizable, rearrangeable panes. Each pane stacks one or more
 * kinds of content as tabs and shows one, an element the layout adopts
 * (moves) into the pane's body, so the WebGL canvas and the Lightspeed panel
 * keep their state when the tree changes.
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

  public isOpen(kind: PaneKind): boolean {
    return leafOf(this._layout, kind) !== null
  }

  /** Show a kind: its tab when it has one, otherwise a new pane under `beside` (or the first pane) with a share of its height. */
  public open(kind: PaneKind, beside?: PaneKind, extent = 0.4): void {
    if (this.isOpen(kind)) {
      const shown = activate(this._layout, kind)
      if (shown !== this._layout) this.layout = shown
      return
    }
    const target = (beside && leafOf(this._layout, beside)) || leaves(this._layout)[0]
    if (!target) return
    this.layout = insertBeside(this._layout, target.id, "bottom", pane(kind), extent)
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
    if (node.type === "pane") return this.buildPane(node)

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

  private buildPane(leaf: PaneLeaf): HTMLElement {
    const { id, kinds, active } = leaf
    const content = this.kinds[active]
    const element = document.createElement("div")
    element.className = "pane"
    element.dataset.id = id

    const header = document.createElement("div")
    header.className = "pane-header"
    header.addEventListener("pointerdown", (event) => this.startPaneDrag(event, id))

    let heading: HTMLElement
    if (kinds.length === 1) {
      heading = document.createElement("span")
      heading.className = "pane-title"
      heading.textContent = content.title
    } else {
      header.classList.add("tabbed")
      heading = document.createElement("div")
      heading.className = "pane-tabs"
      heading.setAttribute("role", "tablist")
      for (const kind of kinds) heading.appendChild(this.buildTab(id, kind, kind === active))
    }

    const actions = document.createElement("span")
    actions.className = "pane-actions"
    for (const action of content.actions ?? []) actions.appendChild(this.iconButton(action.label, action.icon, action.run))
    const options = this.iconButton("Pane options", MORE_ICON, () => this.toggleMenu(options, leaf))
    options.classList.add("pane-options")
    options.setAttribute("aria-haspopup", "menu")
    actions.appendChild(options)

    header.append(heading, actions)

    const body = document.createElement("div")
    body.className = `pane-body ${active}`
    body.dataset.kind = active
    body.setAttribute("role", kinds.length > 1 ? "tabpanel" : "region")
    body.appendChild(content.element)

    element.append(header, body)
    return element
  }

  private buildTab(id: string, kind: PaneKind, selected: boolean): HTMLElement {
    const tab = document.createElement("div")
    tab.className = "pane-tab"
    tab.dataset.kind = kind
    tab.setAttribute("role", "tab")
    tab.setAttribute("aria-selected", String(selected))
    tab.tabIndex = selected ? 0 : -1
    tab.textContent = this.kinds[kind].title
    tab.addEventListener("pointerdown", (event) => {
      event.stopPropagation()
      this.startPaneDrag(event, id, kind)
    })
    tab.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        this.show(kind)
      }
    })
    return tab
  }

  private show(kind: PaneKind): void {
    const shown = activate(this._layout, kind)
    if (shown !== this._layout) this.layout = shown
  }

  private iconButton(label: string, icon: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "icon-button"
    button.title = label
    button.setAttribute("aria-label", label)
    button.innerHTML = icon
    button.addEventListener("click", run)
    return button
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

  /** Carry a pane by its header, or one of its tabs out of it; a press on a tab that never moves shows that tab. */
  private startPaneDrag(event: PointerEvent, id: string, kind?: PaneKind): void {
    if ((event.target as HTMLElement).closest("button")) return
    const leaf = findLeaf(this._layout, id)
    if (!leaf) return
    const whole = !kind || leaf.kinds.length === 1
    if (whole && leaves(this._layout).length <= 1) {
      if (kind) this.show(kind)
      return
    }
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    const paneElement = (event.currentTarget as HTMLElement).closest<HTMLElement>(".pane")!
    const tabElement = kind ? paneElement.querySelector<HTMLElement>(`.pane-tab[data-kind="${kind}"]`) : null
    const title = this.kinds[kind ?? leaf.active].title
    let dragging = false
    let target: { id: string; zone: DropZone; index?: number } | null = null
    let highlight: HTMLElement | null = null
    let ghost: HTMLElement | null = null
    const siblingGrow = new Map<HTMLElement, string>()

    const clearHighlight = () => {
      highlight?.remove()
      highlight = null
    }

    // While it is being carried the pane leaves the layout, so the others
    // show the arrangement a drop would produce; a ghost follows the pointer.
    // A tab carried out of a stack leaves only its tab behind.
    const lift = () => {
      ghost = document.createElement("div")
      ghost.className = "pane-ghost"
      ghost.textContent = title
      document.body.appendChild(ghost)
      if (!whole) {
        tabElement?.classList.add("pane-lifted")
        return
      }
      paneElement.classList.add("pane-lifted")
      const gutter = paneElement.previousElementSibling ?? paneElement.nextElementSibling
      gutter?.classList.add("pane-lifted")
      // Flex only hands out free space in proportion to grow factors that sum
      // to at least 1, so the siblings' fractions are rescaled to sum to 1
      const siblings = [...paneElement.parentElement!.children].filter(
        (child) =>
          child !== paneElement &&
          (child.classList.contains("pane") || child.classList.contains("pane-split")),
      ) as HTMLElement[]
      const total = siblings.reduce((sum, sibling) => sum + (parseFloat(sibling.style.flexGrow) || 0), 0)
      for (const sibling of siblings) {
        siblingGrow.set(sibling, sibling.style.flexGrow)
        sibling.style.flexGrow = String((parseFloat(sibling.style.flexGrow) || 0) / (total || 1))
      }
    }
    const settle = () => {
      tabElement?.classList.remove("pane-lifted")
      paneElement.classList.remove("pane-lifted")
      paneElement.parentElement
        ?.querySelectorAll(".pane-gutter.pane-lifted")
        .forEach((gutter) => gutter.classList.remove("pane-lifted"))
      for (const [sibling, grow] of siblingGrow) sibling.style.flexGrow = grow
      siblingGrow.clear()
      ghost?.remove()
      ghost = null
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
        lift()
      }
      if (ghost) {
        ghost.style.left = `${moveEvent.clientX + 12}px`
        ghost.style.top = `${moveEvent.clientY + 12}px`
      }
      const pointed = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)
      const under = pointed?.closest<HTMLElement>(".pane")
      if (!under || (whole && under.dataset.id === id)) {
        clearHighlight()
        target = null
        return
      }
      const header = pointed?.closest<HTMLElement>(".pane-header")
      const next = header
        ? { id: under.dataset.id!, zone: "centre" as const, index: this.tabIndexAt(header, moveEvent.clientX, kind) }
        : { id: under.dataset.id!, zone: this.zoneAt(under, moveEvent.clientX, moveEvent.clientY) }
      if (next.id === id && next.zone === "centre" && next.index === undefined) {
        clearHighlight()
        target = null
        return
      }
      if (!target || target.id !== next.id || target.zone !== next.zone || target.index !== next.index) {
        clearHighlight()
        target = next
        highlight = header ? this.tabMarker(header, next.index!, kind) : document.createElement("div")
        if (!header) {
          highlight.className = `pane-drop ${next.zone}`
          under.appendChild(highlight)
        }
      }
    }
    const stop = () => {
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", stop)
      document.body.classList.remove("pane-dragging")
      clearHighlight()
      settle()
      if (!dragging && kind) this.show(kind)
      else if (dragging && target) this.layout = movePane(this._layout, id, target.id, target.zone, whole ? undefined : kind, target.index)
    }
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", stop)
  }

  /** Where among a header's tabs, not counting the one carried, a drop at `x` lands. */
  private tabIndexAt(header: HTMLElement, x: number, carried?: PaneKind): number {
    const tabs = this.headerTabs(header, carried)
    const index = tabs.findIndex((tab) => {
      const rect = tab.getBoundingClientRect()
      return x < rect.left + rect.width / 2
    })
    return index === -1 ? tabs.length : index
  }

  private headerTabs(header: HTMLElement, carried?: PaneKind): HTMLElement[] {
    const tabs = [...header.querySelectorAll<HTMLElement>(".pane-tab, .pane-title")]
    return tabs.filter((tab) => !carried || tab.dataset.kind !== carried)
  }

  /** The accent line a tab dropped into a header would sit beside. */
  private tabMarker(header: HTMLElement, index: number, carried?: PaneKind): HTMLElement {
    const tabs = this.headerTabs(header, carried)
    const headerRect = header.getBoundingClientRect()
    const edge = index < tabs.length ? tabs[index].getBoundingClientRect().left : tabs.length ? tabs[tabs.length - 1].getBoundingClientRect().right : headerRect.left
    const marker = document.createElement("div")
    marker.className = "pane-tab-marker"
    marker.style.left = `${edge - headerRect.left}px`
    header.appendChild(marker)
    return marker
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

  private closeKind(kind: PaneKind): void {
    const next = detachKind(this._layout, kind)
    if (next) this.layout = next
  }

  private addBeside(id: string, kind: PaneKind): void {
    this.layout = insertBeside(this._layout, id, "right", pane(kind))
  }

  private addTab(id: string, kind: PaneKind): void {
    this.layout = addTabs(this._layout, id, [kind], kind)
  }

  private toggleMenu(anchor: HTMLElement, leaf: PaneLeaf): void {
    if (this.openMenu) {
      this.closeMenu()
      return
    }
    const open = new Set(leaves(this._layout).flatMap((each) => each.kinds))
    const menu = document.createElement("div")
    menu.className = "pane-menu menu-panel"
    menu.setAttribute("role", "menu")
    const item = (label: string, run: () => void, disabled = false) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "menu-item"
      button.setAttribute("role", "menuitem")
      button.textContent = label
      button.disabled = disabled
      button.addEventListener("click", run)
      menu.appendChild(button)
    }
    const closed = Object.entries(this.kinds).filter(([kind]) => !open.has(kind))
    for (const [kind, content] of closed) item(`Add ${content.title} as a tab`, () => this.addTab(leaf.id, kind))
    for (const [kind, content] of closed) item(`Add ${content.title} beside`, () => this.addBeside(leaf.id, kind))
    if (menu.childElementCount) menu.appendChild(document.createElement("hr"))
    const lastPane = leaves(this._layout).length <= 1
    if (leaf.kinds.length > 1) item(`Close ${this.kinds[leaf.active].title}`, () => this.closeKind(leaf.active))
    else item("Close pane", () => this.closeKind(leaf.active), lastPane)
    anchor.setAttribute("aria-expanded", "true")
    anchor.parentElement!.appendChild(menu)
    this.openMenu = menu
  }

  private closeMenu(): void {
    this.openMenu?.parentElement?.querySelector("[aria-expanded]")?.removeAttribute("aria-expanded")
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
