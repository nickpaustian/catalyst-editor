import BaseWidget from "./BaseWidget"
import { HistoryList } from "@vitrine/catalyst/shared"
import { lerpColour } from "../utils/lerpColour"
import { drawShape } from "../utils"

export default class Histogram extends BaseWidget {
  private _maxValue: number = 100
  private _minValue: number = 0
  private _buckets: number[] = []
  private _currentBucketSize: number = 0
  private readonly _fixedBucketSize: number = 20
  private readonly _maxBuckets: number = 8
  private _lastValueUpdateTime: number = 0

  protected create(): void {
    this._container = document.createElement("div")
    this._container.classList.add("widget", "histogram-widget")
    this._container.id = this._id

    const textElement = document.createElement("div")
    textElement.classList.add("telemetry-text")
    this._container.append(textElement)

    if (this._data.label) {
      const labelElement = document.createElement("div")
      labelElement.classList.add("telemetry-label")
      labelElement.textContent = this._data.label

      this._refs.label = labelElement
      textElement.append(labelElement)
    }

    const valueElement = document.createElement("div")
    valueElement.classList.add("telemetry-value")

    this._refs.value = valueElement
    textElement.append(valueElement)

    const canvas = document.createElement("canvas")
    canvas.className = "histogram-canvas"
    canvas.width = this._data.width || 200
    canvas.height = this._data.height || 200
    this._container.append(canvas)
    this._refs.canvas = canvas

    this._refs.history = new HistoryList<number>({
      length: this._data.historyLength || 200,
    })

    this._buckets = []
    this._currentBucketSize = 0

    this.draw()
  }

  protected onDataChange(property: string, value: any): void {
    if (property === "value" && typeof value === "number") {
      this.addToBucket(value)
      this.updateMaxValue()
      this.draw()
    }
    if (property === "label" && this._refs.label) {
      this._refs.label.textContent = value
    }
    if (property === "showAverage") {
      this.draw()
    }
  }

  private addToBucket(value: number): void {
    const history = this._refs.history as HistoryList<number>
    history.add(value)

    this._currentBucketSize++

    if (this._currentBucketSize === 1) {
      // Start new bucket
      this._buckets.push(value)
    } else {
      // Add to current bucket
      const currentIndex = this._buckets.length - 1
      const currentBucket = this._buckets[currentIndex]
      this._buckets[currentIndex] =
        (currentBucket * (this._currentBucketSize - 1) + value) /
        this._currentBucketSize
    }

    // Bucket is full, reset for next one
    if (this._currentBucketSize >= this._fixedBucketSize) {
      this._currentBucketSize = 0

      // Remove oldest bucket if at max
      if (this._buckets.length > this._maxBuckets) {
        this._buckets.shift()
      }
    }
  }

  private updateMaxValue(): void {
    if (this._buckets.length === 0) return

    const currentMax = Math.max(...this._buckets)
    const threshold = currentMax * 1.5

    // Only update if current max exceeds the max value
    if (currentMax > this._maxValue) {
      this._maxValue = currentMax
    } else if (this._maxValue > threshold) {
      this._maxValue -= 1
    }
  }

  private getSmoothedLatestValue(): number {
    const smoothingLength = 3
    const startIndex = Math.max(0, this._buckets.length - smoothingLength)
    const recentBuckets = this._buckets.slice(startIndex)

    if (recentBuckets.length === 0)
      return this._buckets[this._buckets.length - 1]

    return recentBuckets.reduce((a, b) => a + b, 0) / recentBuckets.length
  }

  private draw(): void {
    const canvas = this._refs.canvas as HTMLCanvasElement
    const history = this._refs.history as HistoryList<number>
    const ctx = canvas.getContext("2d")!
    const padding = 0
    const width = canvas.width - padding * 2
    const height = canvas.height - padding * 2

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (this._buckets.length === 0) return

    const range = this._maxValue - this._minValue || 1
    const pointSpacing = width / (this._buckets.length - 1 || 1)
    const average = history.average()
    const showAverage = this._data.showAverage !== false
    const trailLength = this._data.trailLength || 5

    const smoothedValue = this.getSmoothedLatestValue()

    // Draw vertical lines from each point down to the bottom of the canvas
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"
    ctx.lineWidth = 1
    for (let i = 0; i < this._buckets.length; i++) {
      const value =
        i === this._buckets.length - 1 ? smoothedValue : this._buckets[i]
      const normalised = (value - this._minValue) / range
      const y = padding + height - normalised * height
      const x = padding + i * pointSpacing

      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x, padding + height)
      ctx.stroke()
    }

    const now = Date.now()
    if (now - this._lastValueUpdateTime >= 500) {
      ;(this._refs.value as HTMLElement).textContent = String(
        Math.ceil(smoothedValue) ?? "—"
      )
      this._lastValueUpdateTime = now
    }

    const startIndex = Math.max(0, this._buckets.length - trailLength)
    const lightGrey = { r: 85, g: 85, b: 85 }
    const white = { r: 255, g: 255, b: 255 }

    if (this._buckets.length > 1) {
      for (let i = 0; i < this._buckets.length - 1; i++) {
        const value = this._buckets[i]
        const nextValue =
          i === this._buckets.length - 2 ? smoothedValue : this._buckets[i + 1]

        const prevValue = i > 0 ? this._buckets[i - 1] : value
        const nextNextValue =
          i < this._buckets.length - 2 ? this._buckets[i + 2] : nextValue

        const prevnormalised = (prevValue - this._minValue) / range
        const normalised = (value - this._minValue) / range
        const nextnormalised = (nextValue - this._minValue) / range
        const nextNextnormalised = (nextNextValue - this._minValue) / range

        const prevY = padding + height - prevnormalised * height
        const y = padding + height - normalised * height
        const nextY = padding + height - nextnormalised * height
        const nextNextY = padding + height - nextNextnormalised * height

        const prevX = padding + (i - 1) * pointSpacing
        const x = padding + i * pointSpacing
        const nextX = padding + (i + 1) * pointSpacing
        const nextNextX = padding + (i + 2) * pointSpacing

        // Control points for cubic curve
        const cp1X = x + (nextX - prevX) / 6
        const cp1Y = y + (nextY - prevY) / 6
        const cp2X = nextX - (nextNextX - x) / 6
        const cp2Y = nextY - (nextNextY - y) / 6

        // Calculate colour based on position in trail
        let blend = 0
        if (i >= startIndex) {
          const positionInTrail = i - startIndex
          blend = (positionInTrail + 1) / trailLength
        }

        ctx.strokeStyle =
          i < startIndex
            ? lerpColour(lightGrey, lightGrey, 1)
            : lerpColour(lightGrey, white, blend)
        ctx.lineWidth = 2
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, nextX, nextY)
        ctx.stroke()
      }
    }

    // Draw the latest point
    const smoothednormalised = (smoothedValue - this._minValue) / range
    const smoothedY = padding + height - smoothednormalised * height
    const smoothedX = padding + (this._buckets.length - 1) * pointSpacing

    const shapeType = this._data.shapeType ?? "x"
    const colour = this._data.pointColour ?? "#FFFFFF"

    drawShape(ctx, smoothedX, smoothedY, shapeType, colour)

    // Draw average line
    if (showAverage && average !== undefined) {
      const normalised = (average - this._minValue) / range
      const lineY = padding + height - normalised * height

      ctx.strokeStyle = "rgb(255, 60, 225)"
      ctx.lineWidth = 1
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(padding, lineY)
      ctx.lineTo(padding + width, lineY)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }
}
