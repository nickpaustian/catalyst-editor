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
  emptyFloating,
  removePane,
  type DropZone,
  type FloatRect,
  type FloatingPane,
  type FloatingState,
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
  /** Panes popped out of the tree into windows of their own, and where each kind's window was last. */
  floating?: FloatingState
  onFloatingChange?: (state: FloatingState) => void
}

const MORE_ICON = `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="12.5" cy="8" r="1.25"/></svg>`

const DRAG_THRESHOLD = 4
const EDGE_FRACTION = 0.3
/** A floating window's smallest size, and how much of it must stay on the page so its header can be reached. */
const FLOAT_MIN_WIDTH = 240
const FLOAT_MIN_HEIGHT = 160
const FLOAT_KEEP = 48
const FLOAT_EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const

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
  private readonly onFloatingChange: (state: FloatingState) => void
  private readonly parked = document.createElement("div")
  private readonly floatLayer = document.createElement("div")
  private _layout: LayoutNode
  private _floating: FloatingState
  private openMenu: HTMLElement | null = null

  constructor(options: PaneLayoutOptions) {
    this.root = options.root
    this.kinds = options.kinds
    this.onChange = options.onChange
    this._layout = options.layout
    this._floating = options.floating ?? emptyFloating()
    this.onFloatingChange = options.onFloatingChange ?? (() => undefined)
    this.root.classList.add("pane-root")
    this.parked.className = "pane-parked"
    this.parked.hidden = true
    this.floatLayer.className = "pane-float-layer"
    document.body.append(this.parked, this.floatLayer)
    document.addEventListener("pointerdown", this.closeMenuOnOutsideClick, true)
    window.addEventListener("resize", this.keepFloatingOnPage)
    this.render()
  }

  public get layout(): LayoutNode {
    return this._layout
  }

  public set layout(layout: LayoutNode) {
    this._layout = layout
    // A kind is open in one place: a window holding a kind the tree now has gives it up.
    const docked = new Set(leaves(layout).flatMap((leaf) => leaf.kinds))
    const clashing = this._floating.panes.some((floating) => floating.leaf.kinds.some((kind) => docked.has(kind)))
    if (clashing) {
      const panes = this._floating.panes
        .map((floating) => {
          const kinds = floating.leaf.kinds.filter((kind) => !docked.has(kind))
          return { ...floating, leaf: { ...floating.leaf, kinds, active: kinds.includes(floating.leaf.active) ? floating.leaf.active : kinds[0] } }
        })
        .filter((floating) => floating.leaf.kinds.length > 0)
      this._floating = { ...this._floating, panes }
      this.onFloatingChange(this._floating)
    }
    this.render()
    this.onChange(layout)
  }

  /** The tree and the windows together, as a reset puts them. */
  public replace(layout: LayoutNode, floating: FloatingState = emptyFloating()): void {
    this._floating = floating
    this.layout = layout
    this.onFloatingChange(this._floating)
  }

  public get floating(): FloatingState {
    return this._floating
  }

  public isOpen(kind: PaneKind): boolean {
    return leafOf(this._layout, kind) !== null || this.floatingOf(kind) !== null
  }

  public isFloating(kind: PaneKind): boolean {
    return this.floatingOf(kind) !== null
  }

  /** Show a kind: its tab when it has one (a floating window comes to the front), otherwise a new pane under `beside` (or the first pane) with a share of its height. */
  public open(kind: PaneKind, beside?: PaneKind, extent = 0.4): void {
    const floating = this.floatingOf(kind)
    if (floating) {
      this.setFloating(this.withFloating(floating.leaf.id, { active: kind }, true))
      return
    }
    if (this.isOpen(kind)) {
      const shown = activate(this._layout, kind)
      if (shown !== this._layout) this.layout = shown
      return
    }
    const target = (beside && leafOf(this._layout, beside)) || leaves(this._layout)[0]
    if (!target) return
    this.layout = insertBeside(this._layout, target.id, "bottom", pane(kind), extent)
  }

  /** The body element currently showing a kind, if it is open, docked or floating. */
  public bodyOf(kind: PaneKind): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`.pane-body[data-kind="${kind}"]`) ?? this.floatLayer.querySelector<HTMLElement>(`.pane-body[data-kind="${kind}"]`)
  }

  /** Pop a kind out into a window of its own, where its window was last; a kind not open is opened that way. The tree keeps at least one pane. */
  public float(kind: PaneKind, rect?: FloatRect): void {
    if (this.isFloating(kind)) return this.open(kind)
    let layout = this._layout
    if (leafOf(layout, kind)) {
      const without = detachKind(layout, kind)
      if (!without) return
      layout = without
    }
    const placed = this.onPage(rect ?? this._floating.rects[kind] ?? this.defaultRect())
    const leaf = pane(kind)
    this._layout = layout
    this._floating = { panes: [...this._floating.panes, { leaf, rect: placed }], rects: { ...this._floating.rects, [kind]: placed } }
    this.render()
    this.onChange(this._layout)
    this.onFloatingChange(this._floating)
  }

  /** Put a floating kind's window back in the tree, beside the widest pane. */
  public dock(kind: PaneKind): void {
    const floating = this.floatingOf(kind)
    if (floating) this.dockWindow(floating.leaf.id)
  }

  /** Close a floating kind: its tab, or its window when it was the only one. */
  public closeFloating(kind: PaneKind): void {
    const floating = this.floatingOf(kind)
    if (!floating) return
    const kinds = floating.leaf.kinds.filter((k) => k !== kind)
    if (!kinds.length) return this.setFloating(this._floating.panes.filter((f) => f !== floating))
    const active = floating.leaf.active === kind ? kinds[Math.max(0, floating.leaf.kinds.indexOf(kind) - 1)] : floating.leaf.active
    this.setFloating(this.withFloating(floating.leaf.id, { kinds, active }))
  }

  public dispose(): void {
    document.removeEventListener("pointerdown", this.closeMenuOnOutsideClick, true)
    window.removeEventListener("resize", this.keepFloatingOnPage)
    this.parked.remove()
    this.floatLayer.remove()
  }

  // ---------------- rendering ----------------

  private render(): void {
    this.closeMenu()
    for (const content of Object.values(this.kinds)) this.parked.appendChild(content.element)
    this.root.replaceChildren(this.build(this._layout))
    this.floatLayer.replaceChildren(...this._floating.panes.map((floating) => this.buildFloating(floating)))
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

  private buildPane(leaf: PaneLeaf, floating = false): HTMLElement {
    const { id, kinds, active } = leaf
    const content = this.kinds[active]
    const element = document.createElement("div")
    element.className = "pane"
    element.dataset.id = id

    const header = document.createElement("div")
    header.className = "pane-header"
    header.addEventListener("pointerdown", (event) => (floating ? this.startFloatMove(event, id) : this.startPaneDrag(event, id)))

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
      for (const kind of kinds) heading.appendChild(this.buildTab(id, kind, kind === active, floating))
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

  private buildTab(id: string, kind: PaneKind, selected: boolean, floating = false): HTMLElement {
    const tab = document.createElement("div")
    tab.className = "pane-tab"
    tab.dataset.kind = kind
    tab.setAttribute("role", "tab")
    tab.setAttribute("aria-selected", String(selected))
    tab.tabIndex = selected ? 0 : -1
    tab.textContent = this.kinds[kind].title
    tab.addEventListener("pointerdown", (event) => {
      event.stopPropagation()
      // In a floating window a tab is chosen, not carried; the window is moved by its header.
      if (floating) this.show(kind)
      else this.startPaneDrag(event, id, kind)
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
    const floating = this.floatingOf(kind)
    if (floating) {
      if (floating.leaf.active !== kind) this.setFloating(this.withFloating(floating.leaf.id, { active: kind }))
      return
    }
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
      // A floating window takes a pane only as tabs, dropped on its header.
      if (under?.classList.contains("pane-floating") && !pointed?.closest(".pane-header")) {
        clearHighlight()
        target = null
        return
      }
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
      else if (dragging && target && this.floatingById(target.id)) this.dropIntoWindow(id, whole ? undefined : kind, target.id, target.index)
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
    for (const floating of this._floating.panes) for (const kind of floating.leaf.kinds) open.add(kind)
    const closed = Object.entries(this.kinds).filter(([kind]) => !open.has(kind))
    const windowed = this.floatingById(leaf.id)
    for (const [kind, content] of closed) item(`Add ${content.title} as a tab`, () => (windowed ? this.setFloating(this.withFloating(leaf.id, { kinds: [...leaf.kinds, kind], active: kind })) : this.addTab(leaf.id, kind)))
    if (!windowed) for (const [kind, content] of closed) item(`Add ${content.title} beside`, () => this.addBeside(leaf.id, kind))
    if (menu.childElementCount) menu.appendChild(document.createElement("hr"))
    const title = this.kinds[leaf.active].title
    if (windowed) {
      item("Dock", () => this.dockWindow(leaf.id))
      if (leaf.kinds.length > 1) item(`Close ${title}`, () => this.closeFloating(leaf.active))
      else item("Close window", () => this.closeFloating(leaf.active))
    } else {
      const lastPane = leaves(this._layout).length <= 1
      item(`Pop out ${title}`, () => this.float(leaf.active), lastPane && leaf.kinds.length === 1)
      if (leaf.kinds.length > 1) item(`Close ${title}`, () => this.closeKind(leaf.active))
      else item("Close pane", () => this.closeKind(leaf.active), lastPane)
    }
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

  // ---------------- floating windows ----------------

  private floatingOf(kind: PaneKind): FloatingPane | null {
    return this._floating.panes.find((floating) => floating.leaf.kinds.includes(kind)) ?? null
  }

  private floatingById(id: string): FloatingPane | null {
    return this._floating.panes.find((floating) => floating.leaf.id === id) ?? null
  }

  /** The windows with one leaf changed, and that window brought to the front when asked. */
  private withFloating(id: string, change: Partial<PaneLeaf>, front = false): FloatingPane[] {
    const panes = this._floating.panes.map((floating) => (floating.leaf.id === id ? { ...floating, leaf: { ...floating.leaf, ...change } } : floating))
    if (!front) return panes
    const index = panes.findIndex((floating) => floating.leaf.id === id)
    return index < 0 ? panes : [...panes.slice(0, index), ...panes.slice(index + 1), panes[index]]
  }

  private setFloating(panes: FloatingPane[]): void {
    const rects = { ...this._floating.rects }
    for (const floating of panes) for (const kind of floating.leaf.kinds) rects[kind] = floating.rect
    this._floating = { panes, rects }
    this.render()
    this.onFloatingChange(this._floating)
  }

  private defaultRect(): FloatRect {
    const width = Math.min(560, window.innerWidth - 32)
    const height = Math.min(440, window.innerHeight - 96)
    return { left: Math.max(16, window.innerWidth - width - 48), top: 96, width, height }
  }

  /** A window kept reachable: no larger than the page, its header never above the top or out of reach at the sides. */
  private onPage(rect: FloatRect): FloatRect {
    const width = Math.max(FLOAT_MIN_WIDTH, Math.min(rect.width, window.innerWidth))
    const height = Math.max(FLOAT_MIN_HEIGHT, Math.min(rect.height, window.innerHeight))
    return {
      width,
      height,
      left: Math.min(Math.max(rect.left, FLOAT_KEEP - width), window.innerWidth - FLOAT_KEEP),
      top: Math.min(Math.max(rect.top, 0), window.innerHeight - FLOAT_KEEP),
    }
  }

  private keepFloatingOnPage = (): void => {
    if (!this._floating.panes.length) return
    this._floating = { ...this._floating, panes: this._floating.panes.map((floating) => ({ ...floating, rect: this.onPage(floating.rect) })) }
    for (const floating of this._floating.panes) {
      const element = this.floatLayer.querySelector<HTMLElement>(`.pane-floating[data-id="${floating.leaf.id}"]`)
      if (element) this.placeWindow(element, floating.rect)
    }
  }

  private placeWindow(element: HTMLElement, rect: FloatRect): void {
    element.style.left = `${rect.left}px`
    element.style.top = `${rect.top}px`
    element.style.width = `${rect.width}px`
    element.style.height = `${rect.height}px`
  }

  private buildFloating(floating: FloatingPane): HTMLElement {
    const element = this.buildPane(floating.leaf, true)
    element.classList.add("pane-floating")
    element.setAttribute("role", "dialog")
    element.setAttribute("aria-label", this.kinds[floating.leaf.active].title)
    this.placeWindow(element, floating.rect)
    for (const edge of FLOAT_EDGES) {
      const handle = document.createElement("div")
      handle.className = `pane-float-edge ${edge}`
      handle.addEventListener("pointerdown", (event) => this.startFloatResize(event, floating.leaf.id, edge))
      element.appendChild(handle)
    }
    // A press anywhere in a window brings it to the front, without rebuilding what it holds.
    element.addEventListener("pointerdown", () => this.bringToFront(floating.leaf.id), true)
    return element
  }

  private bringToFront(id: string): void {
    const panes = this._floating.panes
    if (panes[panes.length - 1]?.leaf.id === id) return
    const index = panes.findIndex((floating) => floating.leaf.id === id)
    if (index < 0) return
    this._floating = { ...this._floating, panes: [...panes.slice(0, index), ...panes.slice(index + 1), panes[index]] }
    const element = this.floatLayer.querySelector<HTMLElement>(`.pane-floating[data-id="${id}"]`)
    if (element) this.floatLayer.appendChild(element)
    this.onFloatingChange(this._floating)
  }

  /** Follow a press until it is let go: `move` hears the offset from where it began. */
  private follow(event: PointerEvent, move: (dx: number, dy: number, e: PointerEvent) => void, done: (e: PointerEvent, moved: boolean) => void): void {
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    let moved = false
    const onMove = (e: PointerEvent) => {
      if (!moved && Math.abs(e.clientX - startX) < DRAG_THRESHOLD && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) return
      moved = true
      move(e.clientX - startX, e.clientY - startY, e)
    }
    const onUp = (e: PointerEvent) => {
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onUp)
      document.removeEventListener("pointercancel", onUp)
      done(e, moved)
    }
    document.addEventListener("pointermove", onMove)
    document.addEventListener("pointerup", onUp)
    document.addEventListener("pointercancel", onUp)
  }

  /** The header under a point that a window could be dropped on as tabs: a docked pane's, or another window's. */
  private headerAt(x: number, y: number, carried: HTMLElement): HTMLElement | null {
    for (const element of document.elementsFromPoint(x, y)) {
      if (carried.contains(element)) continue
      const header = element.closest<HTMLElement>(".pane-header")
      if (header) return header
      if (element.closest(".pane")) return null
    }
    return null
  }

  /** Carry a window by its header; let go over another pane's header and its tabs join that pane. */
  private startFloatMove(event: PointerEvent, id: string): void {
    if ((event.target as HTMLElement).closest("button")) return
    const floating = this.floatingById(id)
    const element = (event.currentTarget as HTMLElement).closest<HTMLElement>(".pane-floating")
    if (!floating || !element) return
    const start = floating.rect
    let rect = start
    let drop: { id: string; index: number } | null = null
    let marker: HTMLElement | null = null
    this.follow(
      event,
      (dx, dy, e) => {
        rect = this.onPage({ ...start, left: start.left + dx, top: start.top + dy })
        this.placeWindow(element, rect)
        marker?.remove()
        marker = null
        drop = null
        const header = this.headerAt(e.clientX, e.clientY, element)
        const target = header?.closest<HTMLElement>(".pane")
        if (header && target?.dataset.id) {
          drop = { id: target.dataset.id, index: this.tabIndexAt(header, e.clientX) }
          marker = this.tabMarker(header, drop.index)
          element.classList.add("pane-float-docking")
        } else element.classList.remove("pane-float-docking")
      },
      (_e, moved) => {
        marker?.remove()
        element.classList.remove("pane-float-docking")
        if (!moved) return
        if (drop) return this.windowIntoPane(id, drop.id, drop.index)
        this.setFloatingRect(id, rect)
      },
    )
  }

  private startFloatResize(event: PointerEvent, id: string, edge: (typeof FLOAT_EDGES)[number]): void {
    event.stopPropagation()
    const floating = this.floatingById(id)
    const element = (event.currentTarget as HTMLElement).closest<HTMLElement>(".pane-floating")
    if (!floating || !element) return
    const start = floating.rect
    let rect = start
    document.body.classList.add("pane-float-resizing")
    this.follow(
      event,
      (dx, dy) => {
        let { left, top, width, height } = start
        if (edge.includes("e")) width = Math.max(FLOAT_MIN_WIDTH, start.width + dx)
        if (edge.includes("s")) height = Math.max(FLOAT_MIN_HEIGHT, start.height + dy)
        if (edge.includes("w")) {
          width = Math.max(FLOAT_MIN_WIDTH, start.width - dx)
          left = start.left + start.width - width
        }
        if (edge.includes("n")) {
          height = Math.max(FLOAT_MIN_HEIGHT, start.height - dy)
          top = start.top + start.height - height
        }
        rect = this.onPage({ left, top, width, height })
        this.placeWindow(element, rect)
      },
      (_e, moved) => {
        document.body.classList.remove("pane-float-resizing")
        if (moved) this.setFloatingRect(id, rect)
      },
    )
  }

  /** Keep a window's new place without rebuilding it. */
  private setFloatingRect(id: string, rect: FloatRect): void {
    const panes = this._floating.panes.map((floating) => (floating.leaf.id === id ? { ...floating, rect } : floating))
    const rects = { ...this._floating.rects }
    for (const kind of this.floatingById(id)?.leaf.kinds ?? []) rects[kind] = rect
    this._floating = { panes, rects }
    this.onFloatingChange(this._floating)
  }

  /** A window's tabs join the pane `targetId`, docked or another window. */
  private windowIntoPane(id: string, targetId: string, index: number): void {
    const floating = this.floatingById(id)
    if (!floating || targetId === id) return
    const rest = this._floating.panes.filter((f) => f !== floating)
    const into = rest.find((f) => f.leaf.id === targetId)
    if (into) {
      const kinds = into.leaf.kinds.filter((k) => !floating.leaf.kinds.includes(k))
      const at = Math.max(0, Math.min(index, kinds.length))
      const merged = rest.map((f) => (f === into ? { ...f, leaf: { ...f.leaf, kinds: [...kinds.slice(0, at), ...floating.leaf.kinds, ...kinds.slice(at)], active: floating.leaf.active } } : f))
      return this.setFloating(merged)
    }
    this._layout = addTabs(this._layout, targetId, floating.leaf.kinds, floating.leaf.active, index)
    this._floating = { ...this._floating, panes: rest }
    this.render()
    this.onChange(this._layout)
    this.onFloatingChange(this._floating)
  }

  /** A docked pane, or one of its tabs, carried onto a window's header joins it as tabs. */
  private dropIntoWindow(draggedId: string, kind: PaneKind | undefined, windowId: string, index?: number): void {
    const dragged = findLeaf(this._layout, draggedId)
    const into = this.floatingById(windowId)
    if (!dragged || !into) return
    const moving = kind ? [kind] : dragged.kinds
    const without = kind && dragged.kinds.length > 1 ? detachKind(this._layout, kind) : removePane(this._layout, draggedId)
    if (!without) return
    const kinds = into.leaf.kinds
    const at = Math.max(0, Math.min(index ?? kinds.length, kinds.length))
    this._layout = without
    const panes = this._floating.panes.map((f) => (f === into ? { ...f, leaf: { ...f.leaf, kinds: [...kinds.slice(0, at), ...moving, ...kinds.slice(at)], active: kind ?? dragged.active } } : f))
    this.onChange(this._layout)
    this.setFloating(panes)
  }

  /** A window back in the tree, beside the widest pane, taking a third of its width. */
  private dockWindow(id: string): void {
    const floating = this.floatingById(id)
    if (!floating) return
    const panes = leaves(this._layout)
    const widest = panes.reduce<{ id: string; width: number } | null>((best, leaf) => {
      const width = this.root.querySelector<HTMLElement>(`.pane[data-id="${leaf.id}"]`)?.getBoundingClientRect().width ?? 0
      return !best || width > best.width ? { id: leaf.id, width } : best
    }, null)
    this._layout = widest ? insertBeside(this._layout, widest.id, "right", { ...floating.leaf }, null) : floating.leaf
    this._floating = { ...this._floating, panes: this._floating.panes.filter((f) => f !== floating) }
    this.render()
    this.onChange(this._layout)
    this.onFloatingChange(this._floating)
  }
}

export { findLeaf }
