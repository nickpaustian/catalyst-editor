export type PaneKind = string

export interface PaneLeaf {
  type: "pane"
  id: string
  kind: PaneKind
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

export const pane = (kind: PaneKind): PaneLeaf => ({ type: "pane", id: newId("pane"), kind })

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

/** Put `leaf` beside the pane `targetId`, on the side `zone` names. */
export const insertBeside = (
  node: LayoutNode,
  targetId: string,
  zone: Exclude<DropZone, "centre">,
  leaf: PaneLeaf,
): LayoutNode => {
  const direction = zone === "left" || zone === "right" ? "row" : "column"
  const before = zone === "left" || zone === "top"

  if (node.type === "pane") {
    if (node.id !== targetId) return node
    return split(direction, before ? [leaf, node] : [node, leaf])
  }

  const index = node.children.findIndex((child) => child.type === "pane" && child.id === targetId)
  if (index !== -1 && node.direction === direction) {
    const children = [...node.children]
    const sizes = [...node.sizes]
    const half = sizes[index] / 2
    sizes[index] = half
    children.splice(before ? index : index + 1, 0, leaf)
    sizes.splice(before ? index : index + 1, 0, half)
    return { ...node, children, sizes }
  }

  return {
    ...node,
    children: node.children.map((child) => insertBeside(child, targetId, zone, leaf)),
  }
}

export const swapPanes = (node: LayoutNode, a: string, b: string): LayoutNode => {
  const leafA = findLeaf(node, a)
  const leafB = findLeaf(node, b)
  if (!leafA || !leafB) return node
  const replace = (current: LayoutNode): LayoutNode => {
    if (current.type === "pane") {
      if (current.id === a) return { ...current, kind: leafB.kind }
      if (current.id === b) return { ...current, kind: leafA.kind }
      return current
    }
    return { ...current, children: current.children.map(replace) }
  }
  return replace(node)
}

export const movePane = (
  node: LayoutNode,
  draggedId: string,
  targetId: string,
  zone: DropZone,
): LayoutNode => {
  if (draggedId === targetId) return node
  if (zone === "centre") return swapPanes(node, draggedId, targetId)
  const dragged = findLeaf(node, draggedId)
  if (!dragged) return node
  const without = removePane(node, draggedId)
  if (!without) return node
  return insertBeside(without, targetId, zone, dragged)
}

export const resize = (node: LayoutNode, splitId: string, sizes: number[]): LayoutNode => {
  if (node.type === "pane") return node
  if (node.id === splitId) return { ...node, sizes: normalise(sizes) }
  return { ...node, children: node.children.map((child) => resize(child, splitId, sizes)) }
}

/** True when every leaf names a known kind and no kind appears twice. */
export const isValidLayout = (node: unknown, kinds: Iterable<PaneKind>): node is LayoutNode => {
  const known = new Set(kinds)
  const seen = new Set<PaneKind>()
  const check = (value: any): boolean => {
    if (!value || typeof value !== "object" || typeof value.id !== "string") return false
    if (value.type === "pane") {
      if (!known.has(value.kind) || seen.has(value.kind)) return false
      seen.add(value.kind)
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
