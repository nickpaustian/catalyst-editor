import { Catalyst } from "@vitrine/catalyst"
import { nextTick } from "@vitrine/catalyst"
import { Template } from "./Template"

export class Modal {
  private static instance: Modal
  private _element: HTMLElement
  private _innerEle: HTMLElement
  private _backdropEle: HTMLElement
  private _contentEle: HTMLElement
  private _animationTimeout?: number
  private _currentTemplate: Template | null = null
  private _isOpen: boolean = false
  private _modalCloseTime: number = 0

  constructor() {
    const ui = Catalyst._.ui
    if (!ui) throw new Error("Modal requires the Catalyst ui feature")

    const modal = ui.getScreen("modal")

    this._element = modal

    this._element.classList.add("hidden")

    const modalBackdrop = document.createElement("div")
    this._backdropEle = modalBackdrop
    this._backdropEle.setAttribute("id", "modal-backdrop")
    this._backdropEle.classList.add("full")

    this._element.append(this._backdropEle)

    const modalInner = document.createElement("div")
    this._innerEle = modalInner
    this._innerEle.setAttribute("id", "modal-inner")
    this._innerEle.classList.add("full")

    this._element.append(this._innerEle)

    const modalContent = document.createElement("div")
    this._innerEle.append(modalContent)
    this._contentEle = modalContent

    this._contentEle.setAttribute("id", "modal-content")

    this._contentEle.innerHTML = "Modal content"
  }

  //=========================
  // Getters & Setters
  //=========================

  public static getInstance(): Modal {
    if (!Modal.instance) {
      Modal.instance = new Modal()
    }

    return Modal.instance
  }

  public static get _(): Modal {
    return Modal.getInstance()
  }

  public set content(content: string) {
    this._contentEle.innerHTML = content
  }

  public get isOpen(): boolean {
    return this._isOpen
  }

  public get modalCloseTime(): number {
    return this._modalCloseTime
  }

  //=========================
  // Methods
  //=========================

  private clearAnimationClasses(): void {
    clearTimeout(this._animationTimeout)
    this._element.classList.remove(
      "enter",
      "enter-start",
      "enter-end",
      "exit",
      "exit-start",
      "exit-end"
    )
  }

  private setAnimationDuration(duration: number): void {
    this._element.style.transitionDuration = `${duration}ms`
    this._backdropEle.style.transitionDuration = `${duration}ms`
    this._innerEle.style.transitionDuration = `${duration}ms`
  }

  public open(content?: string, duration: number = 300): void {
    if (content) this.content = content
    Catalyst._.pause()
    this.setAnimationDuration(duration)
    this.clearAnimationClasses()
    document.body.classList.add("modal-open")

    this._element.classList.remove("hidden")
    this._element.classList.add("enter-start")

    this._isOpen = true

    nextTick(() => {
      this._element.classList.add("enter")
      this._element.classList.remove("enter-start")

      this._animationTimeout = setTimeout(() => {
        this.openFinish()
      }, duration)
    })
  }

  private openFinish(): void {
    this._element.classList.add("enter-end")
    nextTick(() => {
      this._element.classList.remove("enter-end")
      this._element.classList.remove("enter")
    })
    Catalyst._.signals.game.onModalOpen.emit()
  }

  public close(duration: number = 300): void {
    this.setAnimationDuration(duration)
    this.clearAnimationClasses()
    this._element.classList.add("exit-start")
    Catalyst._.signals.game.onModalClose.emit()

    this._modalCloseTime = Date.now()
    this._isOpen = false

    nextTick(() => {
      this._element.classList.add("exit")
      this._element.classList.remove("exit-start")

      this._animationTimeout = setTimeout(() => {
        this.closeFinish()
      }, duration)
    })
  }

  public async closeFinish(): Promise<void> {
    this._element.classList.add("exit-end")

    Catalyst._.resume()

    nextTick(() => {
      this._element.classList.remove("exit-end")
      this._element.classList.remove("exit")
    })

    this._element.classList.add("hidden")
    document.body.classList.remove("modal-open")

    if (this._currentTemplate) {
      await this._currentTemplate.executeOnUnload()
      this._currentTemplate = null
      this._contentEle.innerHTML = ""
    }
  }

  /** Hard close without animation, for tearing an exhibition down. */
  public async reset(): Promise<void> {
    this.clearAnimationClasses()
    this._element.classList.add("hidden")
    document.body.classList.remove("modal-open")
    const wasOpen = this._isOpen
    this._isOpen = false
    if (this._currentTemplate) {
      await this._currentTemplate.executeOnUnload()
      this._currentTemplate = null
    }
    this._contentEle.innerHTML = ""
    if (wasOpen) Catalyst._.resume()
  }

  public async openWithTemplate(
    template: Template,
    data?: any,
    duration: number = 300
  ): Promise<void> {
    if (this._currentTemplate) {
      await this._currentTemplate.executeOnUnload()
    }

    try {
      const htmlContent = await template.loadHtml()
      this.content = htmlContent

      await template.executeOnLoad(data)

      this._currentTemplate = template

      this.open(undefined, duration)
    } catch (error) {
      console.error("Error opening modal with template:", error)
      throw error
    }
  }
}
