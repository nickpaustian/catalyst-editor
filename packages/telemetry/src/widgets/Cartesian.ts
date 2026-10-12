import BaseWidget from "./BaseWidget"
import { drawShape } from "../utils"

export default class Cartesian extends BaseWidget {
  private _xValue: number = 0
  private _yValue: number = 0

  protected create(): void {
    this._container = document.createElement("div")
    this._container.classList.add("widget", "cartesian-widget")
    this._container.id = this._id

    // Store config in refs so they persist
    this._refs.gridSpacing = this._data.gridSpacing ?? 0.25
    this._refs.minRange = this._data.minRange ?? -1
    this._refs.maxRange = this._data.maxRange ?? 1

    const textElement = document.createElement("div")
    textElement.classList.add("telemetry-text")
    this._container.append(textElement)

    if (this._data.label) {
      const labelElement = document.createElement("div")
      labelElement.classList.add("telemetry-label")
      labelElement.textContent = this._data.label
      textElement.append(labelElement)
      this._refs.label = labelElement
    }

    const canvasWrapperElement = document.createElement("div")
    canvasWrapperElement.classList.add("canvas-wrapper")
    this._container.append(canvasWrapperElement)

    // Background canvas for static grid/axes
    const bgCanvas = document.createElement("canvas")
    bgCanvas.className = "cartesian-canvas-bg"
    bgCanvas.width = this._data.width || 75
    bgCanvas.height = this._data.height || 75
    bgCanvas.style.position = "absolute"
    canvasWrapperElement.append(bgCanvas)
    this._refs.bgCanvas = bgCanvas

    // Foreground canvas for point
    const fgCanvas = document.createElement("canvas")
    fgCanvas.className = "cartesian-canvas-fg"
    fgCanvas.width = this._data.width || 75
    fgCanvas.height = this._data.height || 75
    fgCanvas.style.position = "absolute"
    canvasWrapperElement.append(fgCanvas)
    this._refs.fgCanvas = fgCanvas

    this._container.style.position = "relative"
    this._container.style.width = `${this._data.width || 75}px`
    this._container.style.height = `${this._data.height || 75}px`

    this._xValue = this._data.x ?? 0
    this._yValue = this._data.y ?? 0

    this.drawBackground()
    this.drawPoint()
  }

  protected onDataChange(property: string, value: any): void {
    if (property === "x" && typeof value === "number") {
      this._xValue = value
      this.drawPoint()
    }
    if (property === "y" && typeof value === "number") {
      this._yValue = value
      this.drawPoint()
    }
    if (property === "label" && this._refs.label) {
      this._refs.label.textContent = value
    }
  }

  private drawBackground(): void {
    const canvas = this._refs.bgCanvas as HTMLCanvasElement
    const ctx = canvas.getContext("2d")!
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const padding = 0
    const radius = Math.min(canvas.width, canvas.height) / 2 - padding

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const minRange = this._refs.minRange as number
    const maxRange = this._refs.maxRange as number
    const gridSpacing = this._refs.gridSpacing as number
    const range = maxRange - minRange
    const pixelsPerUnit = radius / (range / 2)

    // Draw grid
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"
    ctx.lineWidth = 1

    // Calculate grid lines based on spacing
    let gridValue = Math.ceil(minRange / gridSpacing) * gridSpacing
    while (gridValue <= maxRange) {
      if (Math.abs(gridValue) > 0.001) {
        const offset = (gridValue - minRange) * pixelsPerUnit - radius

        // Vertical lines
        ctx.beginPath()
        ctx.moveTo(centerX + offset, centerY - radius)
        ctx.lineTo(centerX + offset, centerY + radius)
        ctx.stroke()

        // Horizontal lines
        ctx.beginPath()
        ctx.moveTo(centerX - radius, centerY - offset)
        ctx.lineTo(centerX + radius, centerY - offset)
        ctx.stroke()
      }
      gridValue += gridSpacing
    }

    // Draw axes
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)"
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(centerX - radius, centerY)
    ctx.lineTo(centerX + radius, centerY)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(centerX, centerY - radius)
    ctx.lineTo(centerX, centerY + radius)
    ctx.stroke()
  }

  private drawPoint(): void {
    const canvas = this._refs.fgCanvas as HTMLCanvasElement
    const ctx = canvas.getContext("2d")!
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const padding = 0
    const radius = Math.min(canvas.width, canvas.height) / 2 - padding

    // Clear foreground canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    const minRange = this._refs.minRange as number
    const maxRange = this._refs.maxRange as number
    const range = maxRange - minRange

    // Normalise values to -1 to 1 range, then scale to pixels
    const normalisedX = ((this._xValue - minRange) / range) * 2 - 1
    const normalisedY = ((this._yValue - minRange) / range) * 2 - 1

    const pointX = centerX + normalisedX * radius
    const pointY = centerY - normalisedY * radius

    const shapeType = this._data.shapeType ?? "diamond"
    const colour = this._data.pointColour ?? "#FFFFFF"

    drawShape(ctx, pointX, pointY, shapeType, colour)
  }
}
