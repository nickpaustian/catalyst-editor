const MIN_BUFFER = 8
const FALLBACK_VIEW = 800

export interface RowWindowOptions<T> {
  /** The scrolling element; its rows carry the class `row` and all share one height. */
  list: () => HTMLElement | undefined
  /** Draws the rows from `before` pixels down, inside a spacer `height` pixels tall. */
  show: (rows: T[], before: number, height: number) => void
  /** The row to keep in view when the list shrinks, as an index into the rows; -1 for none. */
  chosen?: () => number
}

/**
 * Renders only the rows of a long list that are in view, with a screenful either side so a fast scroll does not outrun the next render.
 * The window moves once the view comes within half a screen of either end, not on every row scrolled.
 */
export class RowWindow<T> {
  private rows: T[] = []
  private rowHeight = 24
  private shownFrom = -1
  private shownTo = -1
  private observed: HTMLElement | null = null
  private viewHeight = 0
  private readonly options: RowWindowOptions<T>
  private readonly resized = new ResizeObserver(() => {
    this.keepChosenInView()
    this.slide(true)
  })

  constructor(options: RowWindowOptions<T>) {
    this.options = options
  }

  get all(): readonly T[] {
    return this.rows
  }

  set(rows: T[]): void {
    this.rows = rows
    this.slide(true)
  }

  // Before the list has rendered there is nothing to measure, so a screenful goes out and the next frame measures again
  slide(force = false): void {
    const list = this.element()
    const measured = list?.querySelector<HTMLElement>(".row")?.offsetHeight
    if (measured) this.rowHeight = measured
    const rowHeight = this.rowHeight
    const view = list ? list.clientHeight : FALLBACK_VIEW
    const top = list ? Math.min(list.scrollTop - topPadding(list), Math.max(0, this.rows.length * rowHeight - view)) : 0
    const first = Math.floor(top / rowHeight)
    const last = Math.ceil((top + view) / rowHeight)
    const buffer = Math.max(MIN_BUFFER, last - first)
    const margin = Math.floor(buffer / 2)
    const covered = this.shownFrom <= Math.max(0, first - margin) && this.shownTo >= Math.min(this.rows.length, last + margin)
    if (!force && covered) return
    this.shownFrom = Math.max(0, first - buffer)
    this.shownTo = Math.min(this.rows.length, last + buffer)
    this.options.show(this.rows.slice(this.shownFrom, this.shownTo), this.shownFrom * rowHeight, this.rows.length * rowHeight)
    if (!list || !measured) requestAnimationFrame(() => this.element() && this.slide(true))
  }

  /** Scrolls a row into view so it is rendered. */
  reveal(index: number): void {
    const list = this.element()
    if (!list || index < 0 || index >= this.rows.length) return
    const top = topPadding(list) + index * this.rowHeight
    if (top < list.scrollTop) list.scrollTop = top
    else if (top + this.rowHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + this.rowHeight - list.clientHeight
    this.slide()
  }

  destroy(): void {
    this.resized.disconnect()
  }

  private element(): HTMLElement | null {
    const list = this.options.list()
    if (!list?.isConnected) return null
    if (list !== this.observed) {
      if (this.observed) this.resized.unobserve(this.observed)
      this.observed = list
      this.resized.observe(list)
    }
    return list
  }

  // Something opening beside the list shrinks it, which would hide the row just chosen
  private keepChosenInView(): void {
    const list = this.element()
    if (!list) return
    const before = this.viewHeight
    this.viewHeight = list.clientHeight
    const index = this.options.chosen?.() ?? -1
    if (index < 0 || !before) return
    const top = topPadding(list) + index * this.rowHeight
    if (top >= list.scrollTop && top + this.rowHeight <= list.scrollTop + before) this.reveal(index)
  }
}

const topPadding = (list: HTMLElement): number => parseFloat(getComputedStyle(list).paddingTop) || 0
