import type { TextAsset } from "@vitrine/assets"

export interface TemplateConfig<TData = void> {
  /** Either a URL to fetch, or a registered text asset. */
  path?: string
  asset?: TextAsset
  onLoad?: (data: TData) => void | Promise<void>
  onUnload?: () => void | Promise<void>
}

export class Template<TData = void> {
  private path: string | null
  private asset: TextAsset | null
  private onLoadCallback?: (data: TData) => void | Promise<void>
  private onUnloadCallback?: () => void | Promise<void>
  private htmlContent: string | null = null
  private _isLoaded: boolean = false

  constructor(config: TemplateConfig<TData>) {
    this.path = config.path ?? null
    this.asset = config.asset ?? null
    if (!this.path && !this.asset) {
      throw new Error("Template needs a path or an asset")
    }
    this.onLoadCallback = config.onLoad
    this.onUnloadCallback = config.onUnload
  }

  public get html(): string {
    if (!this.htmlContent) {
      throw new Error("Template HTML not loaded. Call loadHtml() first.")
    }
    return this.htmlContent
  }

  public get isLoaded(): boolean {
    return this._isLoaded
  }

  async loadHtml(): Promise<string> {
    if (this.asset) {
      await this.asset.ensure()
      return this.asset.text
    }

    if (this.htmlContent) {
      return this.htmlContent
    }

    const response = await fetch(this.path!)
    if (!response.ok) {
      throw new Error(
        `Failed to load template: ${this.path} (${response.status})`
      )
    }
    this.htmlContent = await response.text()
    return this.htmlContent
  }

  public async executeOnLoad(data?: any): Promise<void> {
    if (this.onLoadCallback) {
      await this.onLoadCallback(data)
      this._isLoaded = true
    }
  }

  public async executeOnUnload(): Promise<void> {
    if (this.onUnloadCallback) {
      await this.onUnloadCallback()
      this._isLoaded = false
    }
  }

  public clear(): void {
    this.htmlContent = null
    this._isLoaded = false
  }
}
