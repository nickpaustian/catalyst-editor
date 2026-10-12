import createReactiveObject from "../utils/createReactiveObject"

export default abstract class BaseWidget {
  protected _id: string
  protected _container!: HTMLElement
  protected _data: Record<string, any>
  protected _refs: Record<string, any> = {}

  constructor(id: string, initialData?: Record<string, any>) {
    this._id = id
    this._data = initialData || {}
    this.create()
    this._data = createReactiveObject(this._data, (property, value) => {
      this.onDataChange(property, value)
    })
  }

  /**
   * Create the DOM structure for this widget
   */
  protected abstract create(): void

  /**
   * Called whenever data properties change
   */
  protected abstract onDataChange(property: string, value: any): void

  public get id(): string {
    return this._id
  }

  public get container(): HTMLElement {
    return this._container
  }

  public get data(): Record<string, any> {
    return this._data
  }

  public get element(): HTMLElement {
    return this._container
  }

  /**
   * Destroy the widget and clean up
   */
  public destroy(): void {
    this._container?.remove()
  }
}
