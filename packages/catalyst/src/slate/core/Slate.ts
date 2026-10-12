export class Slate {
  private static instance: Slate
  private _canvas: HTMLElement
  private _screens: Map<string, HTMLElement> = new Map()

  private constructor() {
    this._canvas = this.createCanvas()
  }

  //=========================
  // Getters & Setters
  //=========================

  public static getInstance(): Slate {
    if (!Slate.instance) {
      Slate.instance = new Slate()
    }
    return Slate.instance
  }

  public static get _(): Slate {
    return Slate.getInstance()
  }

  public get canvas(): HTMLElement {
    return this._canvas
  }

  private createCanvas(): HTMLElement {
    const canvas = document.createElement("div")
    canvas.id = "slate"
    canvas.classList.add("full")
    document.body.appendChild(canvas)
    return canvas
  }

  public getScreen(name: string): HTMLElement {
    if (!this._screens.has(name)) {
      const screen = document.createElement("div")
      screen.id = `slate-screen-${name}`
      screen.classList.add("full")
      this._canvas.appendChild(screen)
      this._screens.set(name, screen)
    }
    return this._screens.get(name)!
  }
}
