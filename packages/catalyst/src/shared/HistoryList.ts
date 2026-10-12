import * as THREE from "three"
import { debug } from "@vitrine/debug"

interface historyListOptions {
  length?: number
  maxAge?: number // milliseconds
}

interface HistoryEntry<T> {
  value: T
  timestamp: number
}

interface HistoryOperations<T> {
  average(history: T[]): T | undefined
  sum(history: T[]): T | undefined
}

class NumberOperations implements HistoryOperations<number> {
  average(history: number[]): number | undefined {
    if (history.length === 0) return undefined
    return history.reduce((sum, val) => sum + val, 0) / history.length
  }
  sum(history: number[]): number | undefined {
    if (history.length === 0) return undefined
    return history.reduce((sum, val) => sum + val, 0)
  }
}

class Vec3Operations implements HistoryOperations<THREE.Vector3> {
  average(history: THREE.Vector3[]): THREE.Vector3 | undefined {
    if (history.length === 0) return undefined
    const sum = history.reduce(
      (acc, vec) => ({
        x: acc.x + vec.x,
        y: acc.y + vec.y,
        z: acc.z + vec.z,
      }),
      { x: 0, y: 0, z: 0 }
    )
    return new THREE.Vector3(
      sum.x / history.length,
      sum.y / history.length,
      sum.z / history.length
    )
  }
  sum(history: THREE.Vector3[]): THREE.Vector3 | undefined {
    if (history.length === 0) return undefined
    const result = history.reduce(
      (acc, vec) => ({
        x: acc.x + vec.x,
        y: acc.y + vec.y,
        z: acc.z + vec.z,
      }),
      { x: 0, y: 0, z: 0 }
    )
    return new THREE.Vector3(result.x, result.y, result.z)
  }
}

class StringOperations implements HistoryOperations<string> {
  average(history: string[]): string | undefined {
    if (history.length === 0) return undefined
    const frequency = history.reduce((acc, str) => {
      acc[str] = (acc[str] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    return Object.keys(frequency).reduce((a, b) =>
      frequency[a] > frequency[b] ? a : b
    )
  }
  sum(history: string[]): string | undefined {
    return history.join("")
  }
}

export class HistoryList<T> {
  public entries: HistoryEntry<T>[] = []
  private _length: number = 5
  private maxAge: number | null = null
  private operations?: HistoryOperations<T> | null = null

  constructor(options?: historyListOptions) {
    this._length = options?.length || options?.maxAge ? 9999 : 5
    this.maxAge = options?.maxAge || null
  }

  add(item: T): void {
    this.entries.push({
      value: item,
      timestamp: Date.now(),
    })

    // Cull old entries
    this.cull()

    // Also respect length limit
    if (this.entries.length > this._length) {
      this.entries.shift()
    }

    if (!this.operations) this.setOperations()
  }

  public get length(): number {
    return this.entries.length
  }

  /**
   * Remove entries older than maxAge.
   */
  private cull(): void {
    if (this.maxAge === null) return

    const now = Date.now()
    this.entries = this.entries.filter(
      (entry) => now - entry.timestamp < this.maxAge!
    )
  }

  /**
   * Get values only (for operations).
   */
  private getValues(): T[] {
    return this.entries.map((entry) => entry.value)
  }

  clear(): void {
    this.entries = []
  }

  sum(): T | undefined {
    if (!this.operations) {
      debug("No operations handler provided for this type", "warning")
      return
    }
    return this.operations.sum(this.getValues())
  }

  average(): T | undefined {
    if (!this.operations) {
      debug("No operations handler provided for this type", "warning")
      return
    }
    return this.operations.average(this.getValues())
  }

  setOperations(): void {
    const i0 = this.entries[0]?.value
    if (typeof i0 === "number") {
      this.operations =
        new NumberOperations() as unknown as HistoryOperations<T>
    } else if (typeof i0 === "string") {
      this.operations =
        new StringOperations() as unknown as HistoryOperations<T>
    } else if (i0 instanceof THREE.Vector3) {
      this.operations =
        new Vec3Operations() as unknown as HistoryOperations<T>
    } else {
      console.warn(
        "Operations not supported for type:",
        typeof i0,
        i0?.constructor?.name
      )
    }
  }
}
