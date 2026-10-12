import { debug, formatTime } from "../index"

export class Timer {
  private _start: number
  private _end?: number
  // private persist: boolean

  constructor() {
    this._start = Date.now()
    // this.persist = persist
  }

  public start(): void {
    this._start = Date.now()
  }

  public stop(): { raw: number; label: string } {
    this._end = Date.now()

    const diff = this._end - this._start
    const label = formatTime(diff)
    debug(`Timer completed in ${label}`, "timer")

    return { raw: diff, label }
  }
}
