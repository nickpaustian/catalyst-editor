import type { PointCloud } from "../../types"
import type { GaussianSplatData } from "../../types"
import {
  parsePLYAsPointCloud,
  parsePLYAsGaussianSplat,
  parseSOGBundle,
} from "./parsers"
import { PARSE_WORKER_CODE } from "./ParseWorker"

export type FileFormat = "ply" | "sog"
type ParseMode = "pointCloud" | "gaussianSplat"
type ParseResult<T extends ParseMode> = T extends "gaussianSplat"
  ? GaussianSplatData
  : PointCloud

interface PendingParse {
  resolve: (value: GaussianSplatData) => void
  reject: (reason: unknown) => void
}

export class SplatLoader<T extends ParseMode = "pointCloud"> {
  private parseMode: T
  private worker: Worker | null = null
  private workerUrl: string | null = null
  private pending = new Map<number, PendingParse>()
  private nextId = 0

  constructor({
    parseMode = "pointCloud" as T,
    useWorker = false,
  }: { parseMode?: T; useWorker?: boolean } = {}) {
    this.parseMode = parseMode
    if (useWorker && parseMode === "gaussianSplat") {
      this.initWorker()
    }
  }

  async loadFromBuffer(
    buffer: ArrayBuffer,
    format: FileFormat,
  ): Promise<ParseResult<T>> {
    if (this.worker && this.parseMode === "gaussianSplat") {
      return this.parseInWorker(buffer, format) as Promise<ParseResult<T>>
    }
    return this.parse(buffer, format) as Promise<ParseResult<T>>
  }

  async loadFromFile(file: File): Promise<ParseResult<T>> {
    const format = this.detectFormat(file.name)
    const buffer = await file.arrayBuffer()
    return this.loadFromBuffer(buffer, format)
  }

  async loadFromURL(url: string): Promise<ParseResult<T>> {
    const filename = url.split("/").pop() ?? "file"
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      )
    }
    const buffer = await response.arrayBuffer()
    return this.loadFromBuffer(buffer, this.detectFormat(filename))
  }

  dispose(): void {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    if (this.workerUrl) {
      URL.revokeObjectURL(this.workerUrl)
      this.workerUrl = null
    }
    // Reject any in-flight parses
    for (const { reject } of this.pending.values()) {
      reject(new Error("Loader disposed"))
    }
    this.pending.clear()
  }

  private detectFormat(filename: string): FileFormat {
    const ext = filename.split(".").pop()?.toLowerCase()
    if (ext === "ply") return "ply"
    if (ext === "sog") return "sog"
    throw new Error(`Unsupported file format: .${ext}`)
  }

  private async parse(
    buffer: ArrayBuffer,
    format: FileFormat,
  ): Promise<PointCloud | GaussianSplatData> {
    if (format === "ply") {
      if (this.parseMode === "gaussianSplat")
        return parsePLYAsGaussianSplat(buffer)
      return parsePLYAsPointCloud(buffer)
    }
    if (format === "sog") return parseSOGBundle(buffer)
    throw new Error(`No parser for format: ${format}`)
  }

  private initWorker(): void {
    const blob = new Blob([PARSE_WORKER_CODE], {
      type: "application/javascript",
    })
    this.workerUrl = URL.createObjectURL(blob)
    this.worker = new Worker(this.workerUrl)
    this.worker.onmessage = (e: MessageEvent) => {
      const { type, id, result, message } = e.data as {
        type: string
        id: number
        result?: GaussianSplatData
        message?: string
      }
      const pending = this.pending.get(id)
      if (!pending) return
      this.pending.delete(id)
      if (type === "error") pending.reject(new Error(message))
      else if (result) pending.resolve(result)
    }
  }

  private parseInWorker(
    buffer: ArrayBuffer,
    format: FileFormat,
  ): Promise<GaussianSplatData> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ type: "parse", id, format, buffer }, [buffer])
    })
  }
}
