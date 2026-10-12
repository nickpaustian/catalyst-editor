import { Signal } from "./Signal"

export interface StartSignalData {
  timestamp: number
}

export interface UpdateSignalData {
  deltaTime: number
}

export interface ResizeSignalData {
  width: number
  height: number
}

export interface CatalystSignals {
  onStart: Signal<StartSignalData>
  onUpdate: Signal<UpdateSignalData>
  onRender: Signal<UpdateSignalData>
  onPostRender: Signal<UpdateSignalData>
  onResize: Signal<ResizeSignalData>

  // Allow any other registered groups dynamically
  [key: string]: any
}

export class SignalManager implements CatalystSignals {
  // Core signals
  public readonly onStart = new Signal<StartSignalData>()
  public readonly onUpdate = new Signal<UpdateSignalData>()
  public readonly onRender = new Signal<UpdateSignalData>()
  public readonly onPostRender = new Signal<UpdateSignalData>()
  public readonly onResize = new Signal<ResizeSignalData>()

  private customGroups: Map<string, Record<string, Signal<any>>> = new Map()

  constructor() {
    return new Proxy(this, {
      get: (target, prop: string) => {
        // Check if it's a core signal or property
        if (prop in target) {
          return (target as any)[prop]
        }
        // Check custom groups
        return target.customGroups.get(prop)
      },
    }) as any
  }

  public registerGroup<T extends Record<string, Signal<any>>>(
    name: string,
    group: T
  ): void {
    this.customGroups.set(name, group)
  }
}
