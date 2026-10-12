import { debug } from "@vitrine/debug"
import BaseWidget from "./widgets/BaseWidget"
// styles
import stylesCoreRaw from "./styles/core.css?raw"

export default class Telemetry {
  private _panel!: HTMLElement
  private _contentElement!: HTMLElement
  private _widgets: Map<string, BaseWidget> = new Map()
  private _data!: Record<string, any>

  constructor(selector?: string) {
    debug("Telemetry initialised", "class-init")
    this.attachPanel(selector)
    this.attachStyles()
    this.setupDataProxy()
  }

  public get panel(): HTMLElement {
    return this._panel
  }

  public get contentElement(): HTMLElement {
    return this._contentElement
  }

  public get data(): Record<string, any> {
    return this._data
  }

  public registerWidget(widget: BaseWidget): void {
    this._widgets.set(widget.id, widget)
    this._contentElement.append(widget.element)
  }

  public getWidget(id: string): BaseWidget | undefined {
    return this._widgets.get(id)
  }

  public removeWidget(id: string): void {
    const widget = this._widgets.get(id)
    if (widget) {
      widget.destroy()
      this._widgets.delete(id)
    }
  }

  private setupDataProxy(): void {
    this._data = new Proxy(
      {},
      {
        get: (_target, property: string | symbol) => {
          const widget = this._widgets.get(property as string)
          if (!widget) return undefined

          return new Proxy(widget.data, {
            get: (data, prop) => data[prop as string],
            set: (data, prop, value) => {
              data[prop as string] = value
              return true
            },
          })
        },
        set: (_target, property: string | symbol, value) => {
          const widget = this._widgets.get(property as string)
          if (widget) {
            widget.data.value = value // Default to value
          }
          return true
        },
      }
    )
  }

  private attachPanel(selector?: string): void {
    const panel = document.createElement("div")
    panel.setAttribute("id", "telemetry-panel")
    const panelOverlay = document.createElement("div")
    panelOverlay.setAttribute("id", "telemetry-overlay")
    const panelInner = document.createElement("div")
    panelInner.setAttribute("id", "telemetry-panel-inner")
    const panelContent = document.createElement("div")
    panelContent.setAttribute("id", "telemetry-panel-conent")
    panelInner.append(panelContent)
    panel.append(panelOverlay)
    panel.append(panelInner)
    this._panel = panel
    this._contentElement = panelContent
    // Get parent container
    let parent: HTMLElement | null = null
    if (selector) {
      parent = document.querySelector(selector)
    }
    if (!parent) parent = document.body
    parent.append(this.panel)
  }

  private attachStyles(): void {
    const stylesCore = document.createElement("style")
    stylesCore.textContent = stylesCoreRaw
    document.head.appendChild(stylesCore)
  }
}
