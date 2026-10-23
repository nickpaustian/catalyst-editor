/** One line of a context menu: a label with what clicking it does, or a separator. */
export type MenuItem = { label: string; run: () => void; disabled?: boolean; kbd?: string; separator?: false } | { separator: true }

export interface ContextMenuState {
  x: number
  y: number
  items: MenuItem[]
}

const CELL = "editor:contextMenu"

/** Show a context menu at a screen point. The ContextMenu component, mounted once per page, draws it and closes it. */
export const openContextMenu = (x: number, y: number, items: MenuItem[]): void => {
  ;(window as any).lightspeed?.shared(CELL).set({ x, y, items } satisfies ContextMenuState)
}

export const closeContextMenu = (): void => {
  ;(window as any).lightspeed?.shared(CELL).set(null)
}

export const CONTEXT_MENU_CELL = CELL
