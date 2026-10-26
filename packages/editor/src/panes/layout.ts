export type PaneKind = string

export interface PaneLeaf {
  type: "pane"
  id: string
  /** The kinds stacked in the pane as tabs, in order. */
  kinds: PaneKind[]
  /** The tab shown. */
  active: PaneKind
}

export interface PaneSplit {
  type: "split"
  id: string
  direction: "row" | "column"
  children: LayoutNode[]
  /** One fraction per child; they sum to 1. */
  sizes: number[]
}

export type LayoutNode = PaneLeaf | PaneSplit

export type DropZone = "left" | "right" | "top" | "bottom" | "centre"

export const MIN_SIZE = 0.1

let counter = 0
export const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`

export const pane = (...kinds: PaneKind[]): PaneLeaf => ({ type: "pane", id: newId("pane"), kinds, active: kinds[0] })

export const split = (
  direction: PaneSplit["direction"],
  children: LayoutNode[],
  sizes?: number[],
): PaneSplit => ({
  type: "split",
  id: newId("split"),
  direction,
  children,
  sizes: sizes ?? children.map(() => 1 / children.length),
})

export const leaves = (node: LayoutNode): PaneLeaf[] =>
  node.type === "pane" ? [node] : node.children.flatMap(leaves)

export const findLeaf = (node: LayoutNode, id: string): PaneLeaf | null =>
  leaves(node).find((leaf) => leaf.id === id) ?? null

export const leafOf = (node: LayoutNode, kind: PaneKind): PaneLeaf | null =>
  leaves(node).find((leaf) => leaf.kinds.includes(kind)) ?? null

const updateLeaf = (node: LayoutNode, id: string, change: Partial<PaneLeaf>): LayoutNode => {
  if (node.type === "pane") return node.id === id ? { ...node, ...change } : node
  return { ...node, children: node.children.map((child) => updateLeaf(child, id, change)) }
}

export const activate = (node: LayoutNode, kind: PaneKind): LayoutNode => {
  const leaf = leafOf(node, kind)
  return leaf && leaf.active !== kind ? updateLeaf(node, leaf.id, { active: kind }) : node
}

/** Take a kind out of the pane holding it, showing its neighbour; a pane left with no tabs is removed. */
export const detachKind = (node: LayoutNode, kind: PaneKind): LayoutNode | null => {
  const leaf = leafOf(node, kind)
  if (!leaf) return node
  if (leaf.kinds.length === 1) return removePane(node, leaf.id)
  const kinds = leaf.kinds.filter((k) => k !== kind)
  const active = leaf.active === kind ? kinds[Math.min(leaf.kinds.indexOf(kind), kinds.length - 1)] : leaf.active
  return updateLeaf(node, leaf.id, { kinds, active })
}

/** Stack kinds into the pane `targetId` as tabs at `index` (the end without one), showing `active`. */
export const addTabs = (node: LayoutNode, targetId: string, kinds: PaneKind[], active: PaneKind, index?: number): LayoutNode => {
  const target = findLeaf(node, targetId)
  if (!target) return node
  const rest = target.kinds.filter((kind) => !kinds.includes(kind))
  const at = Math.max(0, Math.min(index ?? rest.length, rest.length))
  return updateLeaf(node, targetId, { kinds: [...rest.slice(0, at), ...kinds, ...rest.slice(at)], active })
}

export const normalise = (sizes: number[]): number[] => {
  const total = sizes.reduce((sum, size) => sum + size, 0) || 1
  return sizes.map((size) => size / total)
}

/** Remove a pane; splits left with one child collapse into it. Null if the tree is now empty. */
export const removePane = (node: LayoutNode, id: string): LayoutNode | null => {
  if (node.type === "pane") return node.id === id ? null : node
  const children: LayoutNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, index) => {
    const kept = removePane(child, id)
    if (!kept) return
    children.push(kept)
    sizes.push(node.sizes[index])
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...node, children, sizes: normalise(sizes) }
}

/**
 * A pane's share of the whole root along one axis: the product of its
 * ancestors' fractions in splits of that direction. Splits the other way
 * pass the full extent down. Null when the pane is not in the tree.
 */
export const extentOf = (node: LayoutNode, id: string, direction: PaneSplit["direction"], carried = 1): number | null => {
  if (node.type === "pane") return node.id === id ? carried : null
  for (let i = 0; i < node.children.length; i++) {
    const found = extentOf(node.children[i], id, direction, node.direction === direction ? carried * node.sizes[i] : carried)
    if (found !== null) return found
  }
  return null
}

/** Whether a pane sits under any split of a direction, so it has a size of its own along that axis. */
export const inSplitOf = (node: LayoutNode, id: string, direction: PaneSplit["direction"], under = false): boolean | null => {
  if (node.type === "pane") return node.id === id ? under : null
  for (const child of node.children) {
    const found = inSplitOf(child, id, direction, under || node.direction === direction)
    if (found !== null) return found
  }
  return null
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

/**
 * Put `leaf` beside the pane `targetId`, on the side `zone` names. With
 * `extent`, the share of the root the leaf had along the split's axis, it
 * keeps that size and the target gives up the difference; without it, or
 * when the target has no room, the two share the target's space equally.
 */
export const insertBeside = (
  node: LayoutNode,
  targetId: string,
  zone: Exclude<DropZone, "centre">,
  leaf: PaneLeaf,
  extent?: number | null,
  root: LayoutNode = node,
): LayoutNode => {
  const direction = zone === "left" || zone === "right" ? "row" : "column"
  const before = zone === "left" || zone === "top"
  const targetExtent = extentOf(root, targetId, direction) ?? 1

  if (node.type === "pane") {
    if (node.id !== targetId) return node
    const share = extent ? clamp(extent / targetExtent, MIN_SIZE, 1 - MIN_SIZE) : 0.5
    return split(direction, before ? [leaf, node] : [node, leaf], before ? [share, 1 - share] : [1 - share, share])
  }

  const index = node.children.findIndex((child) => child.type === "pane" && child.id === targetId)
  if (index !== -1 && node.direction === direction) {
    const children = [...node.children]
    let sizes = [...node.sizes]
    const parentExtent = targetExtent / sizes[index]
    const wanted = extent ? clamp(extent / parentExtent, MIN_SIZE, 1 - MIN_SIZE * sizes.length) : null
    let leafSize: number
    if (wanted !== null && Number.isFinite(wanted)) {
      // Every sibling makes room in proportion, which puts back what they gained when the pane left
      leafSize = wanted
      sizes = sizes.map((size) => size * (1 - leafSize))
    } else {
      leafSize = sizes[index] / 2
      sizes[index] -= leafSize
    }
    children.splice(before ? index : index + 1, 0, leaf)
    sizes.splice(before ? index : index + 1, 0, leafSize)
    return { ...node, children, sizes }
  }

  return {
    ...node,
    children: node.children.map((child) => insertBeside(child, targetId, zone, leaf, extent, root)),
  }
}

/**
 * Move the pane `draggedId`, or only its tab `kind`, to the pane `targetId`:
 * beside it on an edge zone, or stacked into it as tabs on the centre, at
 * `index` among its tabs when one is given.
 */
export const movePane = (
  node: LayoutNode,
  draggedId: string,
  targetId: string,
  zone: DropZone,
  kind?: PaneKind,
  index?: number,
): LayoutNode => {
  const dragged = findLeaf(node, draggedId)
  if (!dragged) return node
  const whole = !kind || dragged.kinds.length === 1
  if (draggedId === targetId && (whole || (zone === "centre" && index === undefined))) return node
  const without = whole ? removePane(node, draggedId) : detachKind(node, kind!)
  if (!without) return node
  if (zone === "centre") return addTabs(without, targetId, whole ? dragged.kinds : [kind!], whole ? dragged.active : kind!, index)
  const direction = zone === "left" || zone === "right" ? "row" : "column"
  const extent = whole && inSplitOf(node, draggedId, direction) ? extentOf(node, draggedId, direction) : null
  return insertBeside(without, targetId, zone, whole ? dragged : pane(kind!), extent)
}

export const resize = (node: LayoutNode, splitId: string, sizes: number[]): LayoutNode => {
  if (node.type === "pane") return node
  if (node.id === splitId) return { ...node, sizes: normalise(sizes) }
  return { ...node, children: node.children.map((child) => resize(child, splitId, sizes)) }
}

/** True when every pane holds known kinds, shows one of them, and no kind appears twice. */
export const isValidLayout = (node: unknown, kinds: Iterable<PaneKind>): node is LayoutNode => {
  const known = new Set(kinds)
  const seen = new Set<PaneKind>()
  const check = (value: any): boolean => {
    if (!value || typeof value !== "object" || typeof value.id !== "string") return false
    if (value.type === "pane") {
      if (!Array.isArray(value.kinds) || value.kinds.length === 0 || !value.kinds.includes(value.active)) return false
      for (const kind of value.kinds) {
        if (!known.has(kind) || seen.has(kind)) return false
        seen.add(kind)
      }
      return true
    }
    if (value.type !== "split") return false
    if (value.direction !== "row" && value.direction !== "column") return false
    if (!Array.isArray(value.children) || value.children.length < 2) return false
    if (!Array.isArray(value.sizes) || value.sizes.length !== value.children.length) return false
    return value.children.every(check)
  }
  return check(node)
}

/** Whether a stored tree is from before panes held tabs, when each named one `kind`. */
export const isSingleKindLayout = (node: any): boolean =>
  Boolean(node && typeof node === "object") &&
  (node.type === "pane" ? typeof node.kind === "string" : Array.isArray(node.children) && node.children.some(isSingleKindLayout))

/** A tree from before tabs, with each pane holding its one kind as a tab. */
export const upgradeLayout = (node: any): unknown => {
  if (!node || typeof node !== "object") return node
  if (node.type === "pane" && typeof node.kind === "string") {
    const { kind, ...rest } = node
    return { ...rest, kinds: [kind], active: kind }
  }
  if (node.type === "split" && Array.isArray(node.children)) return { ...node, children: node.children.map(upgradeLayout) }
  return node
}

/** A window's place on the page, in CSS pixels. */
export interface FloatRect {
  left: number
  top: number
  width: number
  height: number
}

/** A pane popped out of the tree: a leaf of tabs in a window of its own, above the layout. */
export interface FloatingPane {
  leaf: PaneLeaf
  rect: FloatRect
}

/** The floating windows, front last, and where each kind's window was last, so it reopens there. */
export interface FloatingState {
  panes: FloatingPane[]
  rects: Record<PaneKind, FloatRect>
}

export const emptyFloating = (): FloatingState => ({ panes: [], rects: {} })

const isRect = (value: any): value is FloatRect =>
  Boolean(value) && ["left", "top", "width", "height"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))

/** Floating windows that hold known kinds, none of them also in `layout` or in another window. */
export const isValidFloating = (value: unknown, kinds: Iterable<PaneKind>, layout: LayoutNode): value is FloatingState => {
  const state = value as FloatingState
  if (!state || typeof state !== "object" || !Array.isArray(state.panes) || !state.rects || typeof state.rects !== "object") return false
  const known = new Set(kinds)
  const seen = new Set(leaves(layout).flatMap((leaf) => leaf.kinds))
  for (const floating of state.panes) {
    const leaf = floating?.leaf
    if (!isRect(floating?.rect) || !leaf || leaf.type !== "pane" || typeof leaf.id !== "string") return false
    if (!Array.isArray(leaf.kinds) || leaf.kinds.length === 0 || !leaf.kinds.includes(leaf.active)) return false
    for (const kind of leaf.kinds) {
      if (!known.has(kind) || seen.has(kind)) return false
      seen.add(kind)
    }
  }
  return Object.values(state.rects).every(isRect)
}
