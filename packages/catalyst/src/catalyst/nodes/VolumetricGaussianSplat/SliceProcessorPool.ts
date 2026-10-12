/**
 *
 * Manages a fixed pool of persistent SliceProcessorWorker instances.
 * Workers are created once at startup and reused for the lifetime of the VGS.
 *
 * Uses Vite's worker import pattern so the worker is bundled properly
 * with full ES module support including @jsquash/webp WASM.
 */

// ---------------------------------------------------------------------------
// Types (shared with worker)
// ---------------------------------------------------------------------------

export interface SliceProcessRequest {
  type: "process"
  id: number
  buffer: ArrayBuffer // raw SOG bundle — transferred to worker (zero copy)
  worldMatrix: Float32Array // 16 elements, column-major
  shBands: number // 0–3, SH bands to decode
}

export interface SliceProcessResult {
  type: "processed"
  id: number
  count: number
  packed: Uint32Array // count × 8 uints, see SplatMaterial/packing.ts
  positions: Float32Array // count × 4 floats (XYZW, W=0) for the sort worker
  sh: Uint32Array // count × shStride uints, see stelligra-wasm pack_sh
  boundsMin: Float32Array // [x, y, z]
  boundsMax: Float32Array // [x, y, z]
}

export interface SliceProcessError {
  type: "error"
  id: number
  message: string
}

interface PendingJob {
  resolve: (result: SliceProcessResult) => void
  reject: (err: Error) => void
}

// ---------------------------------------------------------------------------
// SliceProcessorPool
// ---------------------------------------------------------------------------

export class SliceProcessorPool {
  private _workers: Worker[] = []
  private _idle: Worker[] = []
  private _queue: Array<{ msg: SliceProcessRequest; job: PendingJob }> = []
  private _pending: Map<number, PendingJob> = new Map()
  private _workerForJob: Map<number, Worker> = new Map()

  constructor(poolSize?: number) {
    const size =
      poolSize ??
      Math.min(
        typeof navigator !== "undefined" && navigator.hardwareConcurrency
          ? Math.max(1, navigator.hardwareConcurrency - 1)
          : 2,
        4,
      )

    for (let i = 0; i < size; i++) {
      // Vite bundles the worker file with full ES module support
      // including @jsquash/webp WASM
      const worker = new Worker(
        new URL("./SliceProcessorWorker.ts", import.meta.url),
        { type: "module" },
      )
      worker.onmessage = (e: MessageEvent) => this._onMessage(worker, e)
      worker.onerror = (e: ErrorEvent) => {
        console.error(
          "Worker onerror:",
          e.message,
          e.filename,
          e.lineno,
          e.error,
        )
        this._onError(worker, e)
      }
      this._workers.push(worker)
      this._idle.push(worker)
    }

    for (const worker of this._workers) {
      worker.postMessage({ type: "warmup" })
    }
  }

  get poolSize(): number {
    return this._workers.length
  }
  get queueLength(): number {
    return this._queue.length
  }
  get activeCount(): number {
    return this._pending.size
  }

  /**
   * Process a SOG buffer off-thread.
   * The buffer is transferred zero-copy to the worker.
   * Resolves with pre-scattered GPU-ready buffers.
   */
  process(msg: SliceProcessRequest): Promise<SliceProcessResult> {
    return new Promise((resolve, reject) => {
      const job: PendingJob = { resolve, reject }
      const worker = this._idle.pop()
      if (worker) {
        this._dispatch(worker, msg, job)
      } else {
        this._queue.push({ msg, job })
      }
    })
  }

  dispose(): void {
    for (const worker of this._workers) worker.terminate()
    this._workers = []
    this._idle = []
    this._queue = []
    this._pending.clear()
    this._workerForJob.clear()
  }

  private _dispatch(
    worker: Worker,
    msg: SliceProcessRequest,
    job: PendingJob,
  ): void {
    this._pending.set(msg.id, job)
    this._workerForJob.set(msg.id, worker)
    worker.postMessage(msg, [msg.buffer])
  }

  private _onMessage(worker: Worker, e: MessageEvent): void {
    const msg = e.data as SliceProcessResult | SliceProcessError

    const job = this._pending.get(msg.id)
    if (!job) return

    this._pending.delete(msg.id)
    this._workerForJob.delete(msg.id)

    // Dispatch next job BEFORE resolving — worker never waits
    const next = this._queue.shift()
    if (next) {
      this._dispatch(worker, next.msg, next.job)
    } else {
      this._idle.push(worker)
    }

    // Resolve immediately — no queue, no frame wait
    if (msg.type === "error") {
      job.reject(new Error((msg as SliceProcessError).message))
    } else {
      job.resolve(msg as SliceProcessResult)
    }
  }

  private _onError(worker: Worker, e: ErrorEvent): void {
    for (const [id, w] of this._workerForJob) {
      if (w === worker) {
        const job = this._pending.get(id)
        if (job) {
          job.reject(new Error(`Worker error: ${e.message}`))
          this._pending.delete(id)
          this._workerForJob.delete(id)
        }
        break
      }
    }
    const next = this._queue.shift()
    if (next) {
      this._dispatch(worker, next.msg, next.job)
    } else {
      this._idle.push(worker)
    }
  }
}
