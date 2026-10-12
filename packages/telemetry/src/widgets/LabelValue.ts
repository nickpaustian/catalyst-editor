import BaseWidget from "./BaseWidget"

export default class LabelValue extends BaseWidget {
  protected create(): void {
    this._container = document.createElement("div")
    this._container.className = "widget label-value-widget"
    this._container.id = this._id

    if (this._data.label) {
      const labelElement = document.createElement("span")
      labelElement.className = "label-value-label"
      labelElement.textContent = `${this._data.label}: `
      this._container.append(labelElement)
      this._refs.label = labelElement
    }

    const valueElement = document.createElement("span")
    valueElement.className = "label-value-value"
    valueElement.textContent = String(this._data.value ?? "—")
    this._container.append(valueElement)
    this._refs.value = valueElement
  }

  protected onDataChange(property: string, value: any): void {
    if (property === "value" && this._refs.value) {
      this._refs.value.textContent = String(value ?? "—")
    }
    if (property === "label" && this._refs.label) {
      this._refs.label.textContent = `${value}: `
    }
  }
}
