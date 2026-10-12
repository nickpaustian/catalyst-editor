interface FetchRequest {
  url: string
  priority: number
  depth: number
  distance: number
  controller: AbortController
  resolve: (buffer: ArrayBuffer) => void
  reject: (err: unknown) => void
}

interface OctantFetcherOptions {
  maxConcurrent?: number
  cache?: {
    enabled: boolean
    dbName?: string
    maxSizeMb?: number
  }
}

class OctantDiskCache {
  private _db: IDBDatabase | null = null
  private _dbName: string
  private _maxBytes: number
  private _ready: Promise<void>

  private static readonly STORE = "octants"
  private static readonly META_STORE = "meta"

  constructor(dbName = "octant-cache", maxSizeMb = 512) {
    this._dbName = dbName
    this._maxBytes = maxSizeMb * 1024 * 1024
    this._ready = this._open()
  }

  private _open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this._dbName, 1)

      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result

        if (!db.objectStoreNames.contains(OctantDiskCache.STORE)) {
          db.createObjectStore(OctantDiskCache.STORE, { keyPath: "url" })
        }

        if (!db.objectStoreNames.contains(OctantDiskCache.META_STORE)) {
          db.createObjectStore(OctantDiskCache.META_STORE, { keyPath: "id" })
        }

        // Write the initial meta record using the upgrade transaction directly

        const upgradeTx = (e.target as IDBOpenDBRequest).transaction!
        upgradeTx
          .objectStore(OctantDiskCache.META_STORE)
          .add({ id: "stats", totalBytes: 0 })
      }

      req.onsuccess = (e) => {
        this._db = (e.target as IDBOpenDBRequest).result
        resolve()
      }

      req.onerror = () => reject(req.error)
    })
  }

  async get(url: string): Promise<ArrayBuffer | null> {
    await this._ready
    if (!this._db) return null

    return new Promise((resolve) => {
      const tx = this._db!.transaction(OctantDiskCache.STORE, "readwrite")
      const req = tx.objectStore(OctantDiskCache.STORE).get(url)

      req.onsuccess = () => {
        if (!req.result) return resolve(null)

        // Update lastAccessed for LRU eviction
        req.result.lastAccessed = Date.now()
        tx.objectStore(OctantDiskCache.STORE).put(req.result)
        resolve(req.result.buffer)
      }

      req.onerror = () => resolve(null)
    })
  }

  async set(url: string, buffer: ArrayBuffer): Promise<void> {
    await this._ready
    if (!this._db) return

    const size = buffer.byteLength

    await this._evictIfNeeded(size)

    return new Promise((resolve) => {
      const tx = this._db!.transaction(
        [OctantDiskCache.STORE, OctantDiskCache.META_STORE],
        "readwrite",
      )

      tx.objectStore(OctantDiskCache.STORE).put({
        url,
        buffer,
        size,
        lastAccessed: Date.now(),
      })

      const metaStore = tx.objectStore(OctantDiskCache.META_STORE)
      const metaReq = metaStore.get("stats")

      metaReq.onsuccess = () => {
        const stats = metaReq.result ?? { id: "stats", totalBytes: 0 }
        stats.totalBytes += size
        metaStore.put(stats)
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve() // non-fatal
    })
  }

  private async _evictIfNeeded(incomingBytes: number): Promise<void> {
    if (!this._db) return

    const totalBytes = await this._getTotalBytes()
    if (totalBytes + incomingBytes <= this._maxBytes) return

    // LRU eviction — get all entries sorted by lastAccessed
    const entries = await this._getAllEntries()
    entries.sort((a, b) => a.lastAccessed - b.lastAccessed)

    let freed = 0
    const toEvict: string[] = []
    for (const entry of entries) {
      if (totalBytes + incomingBytes - freed <= this._maxBytes) break
      toEvict.push(entry.url)
      freed += entry.size
    }

    if (!toEvict.length) return

    return new Promise((resolve) => {
      const tx = this._db!.transaction(
        [OctantDiskCache.STORE, OctantDiskCache.META_STORE],
        "readwrite",
      )

      toEvict.forEach((url) =>
        tx.objectStore(OctantDiskCache.STORE).delete(url),
      )

      const metaStore = tx.objectStore(OctantDiskCache.META_STORE)
      const metaReq = metaStore.get("stats")
      metaReq.onsuccess = () => {
        const stats = metaReq.result ?? { id: "stats", totalBytes: 0 }
        stats.totalBytes = Math.max(0, stats.totalBytes - freed)
        metaStore.put(stats)
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  }

  private _getTotalBytes(): Promise<number> {
    return new Promise((resolve) => {
      const tx = this._db!.transaction(OctantDiskCache.META_STORE, "readonly")
      const req = tx.objectStore(OctantDiskCache.META_STORE).get("stats")
      req.onsuccess = () => resolve(req.result?.totalBytes ?? 0)
      req.onerror = () => resolve(0)
    })
  }

  private _getAllEntries(): Promise<
    { url: string; size: number; lastAccessed: number }[]
  > {
    return new Promise((resolve) => {
      const tx = this._db!.transaction(OctantDiskCache.STORE, "readonly")
      const req = tx.objectStore(OctantDiskCache.STORE).getAll()
      req.onsuccess = () => resolve(req.result ?? [])
      req.onerror = () => resolve([])
    })
  }

  async clear(): Promise<void> {
    await this._ready
    if (!this._db) return

    return new Promise((resolve) => {
      const tx = this._db!.transaction(
        [OctantDiskCache.STORE, OctantDiskCache.META_STORE],
        "readwrite",
      )
      tx.objectStore(OctantDiskCache.STORE).clear()

      const metaStore = tx.objectStore(OctantDiskCache.META_STORE)
      metaStore.put({ id: "stats", totalBytes: 0 })

      tx.oncomplete = () => resolve()
    })
  }
}

export class OctantFetcher {
  private _queue: FetchRequest[] = []
  private _activeCount: number = 0
  private _maxConcurrent: number
  private _diskCache: OctantDiskCache | null = null

  constructor(options: OctantFetcherOptions = {}) {
    this._maxConcurrent = options.maxConcurrent ?? 128

    if (options.cache?.enabled) {
      this._diskCache = new OctantDiskCache(
        options.cache.dbName ?? "octant-cache",
        options.cache.maxSizeMb ?? 512,
      )
    }
  }

  fetch(
    url: string,
    opts: { priority?: number; depth?: number; distance?: number } = {},
  ): { promise: Promise<ArrayBuffer>; abort: () => void } {
    const controller = new AbortController()

    const promise = new Promise<ArrayBuffer>((resolve, reject) => {
      this._queue.push({
        url,
        priority: opts.priority ?? 0,
        depth: opts.depth ?? 0,
        distance: opts.distance ?? 0,
        controller,
        resolve,
        reject,
      })
    })

    this._drain()

    return { promise, abort: () => controller.abort() }
  }

  private _drain(): void {
    this._queue.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth
      if (a.priority !== b.priority) return b.priority - a.priority
      return a.distance - b.distance
    })

    while (this._queue.length > 0 && this._activeCount < this._maxConcurrent) {
      const request = this._queue.shift()!
      this.execute(request)
    }
  }

  private async execute(request: FetchRequest): Promise<void> {
    this._activeCount++

    try {
      // Network fetch — browser HTTP cache handles repeat visits
      const response = await fetch(request.url, {
        signal: request.controller.signal,
      })

      if (!response.ok)
        throw new Error(`HTTP ${response.status} for ${request.url}`)

      const buffer = await response.arrayBuffer()
      request.resolve(buffer)
    } catch (err) {
      request.reject(err)
    } finally {
      this._activeCount--
      this._drain()
    }
  }

  public cancelAll(): void {
    this._queue.forEach((r) => r.controller.abort())
    this._queue = []
  }

  async clearCache(): Promise<void> {
    await this._diskCache?.clear()
  }

  get stats() {
    return {
      queued: this._queue.length,
      active: this._activeCount,
    }
  }
}
