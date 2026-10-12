/**
 * Template class for managing template content
 */

export interface TemplateConfig<TData = void> {
  path: string
  onLoad?: (data: TData) => void | Promise<void>
  onUnload?: () => void | Promise<void>
}

export class Template<TData = void> {
  private path: string
  private onLoadCallback?: (data: TData) => void | Promise<void>
  private onUnloadCallback?: () => void | Promise<void>
  private htmlContent: string | null = null
  private _isLoaded: boolean = false

  constructor(config: TemplateConfig<TData>) {
    this.path = config.path
    this.onLoadCallback = config.onLoad
    this.onUnloadCallback = config.onUnload
  }

  //=========================
  // Getters & Setters
  //=========================

  public get html(): string {
    if (!this.htmlContent) {
      throw new Error("Template HTML not loaded. Call loadHtml() first.")
    }
    return this.htmlContent
  }

  public get isLoaded(): boolean {
    return this._isLoaded
  }

  //=========================
  // Methods
  //=========================

  async loadHtml(): Promise<string> {
    if (this.htmlContent) {
      return this.htmlContent
    }

    try {
      const response = await fetch(this.path)
      if (!response.ok) {
        throw new Error(
          `Failed to load template: ${this.path} (${response.status})`
        )
      }
      this.htmlContent = await response.text()
      return this.htmlContent
    } catch (error) {
      console.error(`Error loading template from ${this.path}:`, error)
      throw error
    }
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

  //=========================
  // Cleanup
  //=========================

  public clear(): void {
    this.htmlContent = null
    this._isLoaded = false
  }
}
