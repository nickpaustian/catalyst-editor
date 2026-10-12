export interface BoundsConfig {
  min?: number
  max?: number
}

export class Bounds {
  private _min: number
  private _max: number

  constructor(config: BoundsConfig = {}) {
    this._min = config.min ?? -Infinity
    this._max = config.max ?? Infinity
  }

  public get min(): number {
    return this._min
  }

  public set min(value: number) {
    this._min = value
  }

  public get max(): number {
    return this._max
  }

  public set max(value: number) {
    this._max = value
  }

  public contains(value: number): boolean {
    return value >= this._min && value <= this._max
  }

  public overshoot(value: number): number {
    if (value < this._min) return value - this._min
    if (value > this._max) return value - this._max
    return 0
  }

  public clamp(value: number): number {
    return Math.max(this._min, Math.min(this._max, value))
  }
}
