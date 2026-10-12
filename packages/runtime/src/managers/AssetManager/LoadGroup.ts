/**
 * LoadGroup manages the loading, processing, and tracking of a group of assets (and optionally child load groups).
 * It handles parallel loading with retry logic, progress tracking, and resource cleanup.
 *
 * Features:
 * - Parallel asset loading with priority support
 * - Support for nested child load groups with recursive total size calculation
 * - Progress tracking with speed and time estimation, aggregated from all children
 * - Error handling with configurable retry logic
 * - Resource cleanup for different asset types
 * - Detailed loading statistics and progress reporting
 *
 * Updated to ensure total file size is calculated once at the top level:
 * - The top-level group calculates total sizes recursively.
 * - Children do not recalculate sizes in their load methods.
 * - Prevents multiple HEAD requests and ensures stable progress reporting.
 */

import { debug } from "../../utils"
import { type ResourceLoadConfig } from "./assets/Asset"
import PreferenceManager from "../PreferenceManager"
import DBManager from "../DBManager"
import { namespace } from "../../constants"
import type { ResourceType } from "./types"

export interface LoadGroupConfig {
  name: string
  assets: ResourceLoadConfig[]
  children?: LoadGroupConfig[]
  onAssetLoaded?: (asset: LoadedAsset, group: LoadGroup) => void
  onComplete?: (assets: LoadedAsset[], group: LoadGroup) => void
  onProgress?: (progress: LoadProgress, group: LoadGroup) => void
  onError?: (errors: LoadError[], group: LoadGroup) => void
  maxRetries?: number
  retryDelay?: number
  priority?: number
  manualComplete?: boolean
  debug?: boolean
}

export interface LoadProgress {
  groupName: string
  loaded: number
  total: number
  percentage: number
  currentAsset?: string
  bytesLoaded?: number
  totalBytes?: number
  currentSpeed?: number
  averageSpeed?: number
  estimatedTimeRemaining?: number
  stableEstimatedTimeRemaining?: number
}

export interface LoadError {
  assetId: string
  type: ResourceType
  error: Error
  attempts: number
}

export const AssetType = {
  MODEL: "model",
  TEXTURE: "texture",
  AUDIO: "audio",
  IMAGE: "image",
  SPLAT: "splat",
  HDRI: "hdri",
} as const

export type AssetType = (typeof AssetType)[keyof typeof AssetType]

export const LoadStatus = {
  PENDING: "pending",
  LOADING: "loading",
  COMPLETE: "complete",
  ERROR: "error",
} as const

export type LoadStatus = (typeof LoadStatus)[keyof typeof LoadStatus]

export interface AssetLoadItem {
  config: ResourceLoadConfig
  status: LoadStatus
  attempts: number
}

export interface LoadedAsset {
  key: string
  type: ResourceType
  data: any
  options?: any
}

export default class LoadGroup {
  // CORE PROPERTIES
  private readonly name: string
  private readonly maxRetries: number
  private readonly retryDelay: number
  private readonly priority: number
  private readonly speedSampleSize: number = 5
  private readonly speedUpdateInterval: number = 100
  private lastSpeedMeasurementTime: number = 0
  private readonly manualComplete: boolean
  private parentGroup: LoadGroup | null = null
  private debug: boolean = false
  private preferenceManager: PreferenceManager
  private useIndexDb: boolean | null = false
  private dbManager!: DBManager

  // ASSET TRACKING
  private readonly assets: Map<string, AssetLoadItem> = new Map()
  private readonly sortedAssets: AssetLoadItem[]
  private readonly processedAssets: Set<string> = new Set()
  private loadedAssets: LoadedAsset[] = []
  private assetsFinished: boolean = false
  private errors: LoadError[] = []

  // CHILD GROUPS
  private readonly children: LoadGroup[] = []

  // LOAD STATE
  private status: LoadStatus = LoadStatus.PENDING
  private loadStartTime: number = 0
  private loadEndTime: number = 0
  private totalBytes: number = 0
  private loadedBytes: number = 0

  // FLAG to indicate if sizes have been initialised
  private sizesInitialised: boolean = false

  // SPEED TRACKING
  private readonly speedMeasurements: { timestamp: number; bytes: number }[] =
    []
  private lastETRs: number[] = []
  private readonly etrHistorySize: number = 10
  private readonly etrStabilityThreshold = 0.5

  // CALLBACKS
  private onProgress?: (progress: LoadProgress, group: LoadGroup) => void
  private onComplete?: (assets: LoadedAsset[], group: LoadGroup) => void
  private onAssetLoaded?: (asset: LoadedAsset, group: LoadGroup) => void
  private onError?: (errors: LoadError[], group: LoadGroup) => void

  private readyToComplete: boolean = false
  private manuallyCompleted: boolean = false

  private progressUpdateInterval: number = 100
  private lastProgressUpdateTime: number = 0

  constructor(config: LoadGroupConfig) {
    // Initialise core properties
    this.name = config.name
    this.maxRetries = config.maxRetries ?? 3
    this.retryDelay = config.retryDelay ?? 1000
    this.priority = config.priority ?? 0
    this.manualComplete = config.manualComplete ?? false
    this.debug = config.debug ?? false

    // Store callbacks
    this.onProgress = config.onProgress
    this.onComplete = config.onComplete
    this.onAssetLoaded = config.onAssetLoaded
    this.onError = config.onError

    this.preferenceManager = PreferenceManager.getInstance()

    this.useIndexDb = this.preferenceManager.getPreference("use-indexDb", true)

    if (this.useIndexDb) {
      this.dbManager = DBManager.getInstance(`${namespace}-db`, `asset-store`)
      this.dbManager.init()
    }

    // Initialise asset collections
    config.assets = config?.assets ?? []
    this.assets = new Map()
    config.assets.forEach((asset) => {
      this.assets.set(asset.key, {
        config: asset,
        status: LoadStatus.PENDING,
        attempts: 0,
      })
    })

    this.sortedAssets = Array.from(this.assets.values()).sort(
      (a, b) => (b.config.priority || 0) - (a.config.priority || 0)
    )

    // Initialise children if provided
    if (config.children && config.children.length > 0) {
      this.children = config.children.map((childConfig) => {
        const childGroup = new LoadGroup({
          ...childConfig,
          debug: childConfig?.debug ?? this.debug,
        })
        childGroup.parentGroup = this

        const originalChildProgress = childGroup.onProgress
        childGroup.onProgress = (childProgress, group) => {
          if (originalChildProgress) originalChildProgress(childProgress, group)
          this.handleChildProgress()
        }

        const originalChildComplete = childGroup.onComplete
        childGroup.onComplete = (assets, group) => {
          if (originalChildComplete) originalChildComplete(assets, group)

          if (group.getStatus() === LoadStatus.COMPLETE) {
            const existingIds = new Set(this.loadedAssets.map((a) => a.key))
            const newAssets = assets.filter((a) => !existingIds.has(a.key))
            this.loadedAssets.push(...newAssets)

            if (this.assetsFinished) {
              this.checkForCompletion()
            }
          }
        }

        const originalChildError = childGroup.onError
        childGroup.onError = (errs, group) => {
          if (originalChildError) originalChildError(errs, group)
          this.errors.push(...errs)
          this.handleChildProgress()
        }

        const originalChildAssetLoaded = childGroup.onAssetLoaded
        childGroup.onAssetLoaded = (asset, group) => {
          if (originalChildAssetLoaded) originalChildAssetLoaded(asset, group)
          this.handleChildProgress()
        }

        return childGroup
      })
    }
  }

  //===============================
  //     LIFECYCLE METHODS
  //===============================

  public load: () => Promise<void> = async () => {
    this.status = LoadStatus.LOADING
    this.errors = []
    this.loadStartTime = performance.now()

    // Only initialise sizes if not already done
    if (!this.sizesInitialised) {
      const total = await this.calculateTotalSizesRecursive()
      this.totalBytes = total
      this.sizesInitialised = true
    }

    // Combine parent assets and children into a single collection of "targets"
    const allTargets: Array<{
      type: "asset" | "group"
      priority: number
      item: AssetLoadItem | LoadGroup
    }> = []

    // Add parent assets
    for (const item of this.sortedAssets) {
      allTargets.push({
        type: "asset",
        priority: item.config.priority || 0,
        item,
      })
    }

    // Add children
    for (const child of this.children) {
      allTargets.push({
        type: "group",
        priority: child.getPriority(),
        item: child,
      })
    }

    // Group targets by priority
    const priorityMap = new Map<number, Array<{ type: string; item: any }>>()
    for (const t of allTargets) {
      if (!priorityMap.has(t.priority)) priorityMap.set(t.priority, [])
      priorityMap.get(t.priority)!.push({ type: t.type, item: t.item })
    }

    const sortedPriorities = Array.from(priorityMap.keys()).sort(
      (a, b) => b - a
    )

    // Load each priority level in sequence
    for (const level of sortedPriorities) {
      const targets = priorityMap.get(level)!
      // Load all targets of this priority in parallel
      await Promise.all(
        targets.map(async (t) => {
          if (t.type === "asset") {
            const item: AssetLoadItem = t.item
            const id = Array.from(this.assets.entries()).find(
              ([_, val]) => val === item
            )?.[0]

            if (!id) return
            if (item.status !== LoadStatus.COMPLETE) {
              try {
                await this.loadAsset(id, item)
              } catch (error) {
                this.handleAssetError(id, item, error as Error)
              }
            }
          } else {
            const child = t.item as LoadGroup
            await child.load()
            // Only add assets if child is actually complete
            if (child.getStatus() === LoadStatus.COMPLETE) {
              this.loadedAssets.push(...child.getLoadedAssets())
            }
          }
        })
      )
    }

    this.assetsFinished = true
    this.checkForCompletion()
  }

  private finaliseLoad: () => void = () => {
    this.loadEndTime = performance.now()

    this.children.forEach((child) => {
      this.errors.push(...child.getErrors())
    })

    // Always call onComplete when assets are finished, passing 'this'
    if (this.onComplete) {
      this.onComplete(this.loadedAssets, this)
      this.loadedAssets.forEach((asset) => {
        this.processedAssets.add(asset.key)
      })
    }

    this.readyToComplete = true

    if (!this.manualComplete || this.manuallyCompleted) {
      this.completeGroup()
    }

    this.checkChildrenCompletion()
  }

  private checkForCompletion(): void {
    if (this.debug) this.outputDebug("Checking for completion")
    if (
      this.assetsFinished &&
      this.children.every((child) => child.getStatus() === LoadStatus.COMPLETE)
    ) {
      this.finaliseLoad()
    }
  }

  public markAsComplete(): void {
    if (!this.manualComplete) {
      console.warn(
        "Attempted to manually complete a load group that doesn't have manual completion enabled"
      )
      return
    }

    if (!this.readyToComplete) {
      console.warn(
        "Attempted to manually complete a load group before assets finished loading"
      )
      return
    }

    this.manuallyCompleted = true
    this.completeGroup()

    if (this.parentGroup) {
      this.parentGroup.checkForCompletion()
    }
  }

  private checkChildrenCompletion(): void {
    if (this.children.length === 0) return

    const allChildrenComplete = this.children.every(
      (child) => child.getStatus() === LoadStatus.COMPLETE
    )

    if (allChildrenComplete && this.readyToComplete) {
      if (!this.manualComplete || this.manuallyCompleted) {
        this.completeGroup()
      }
    }
  }

  private completeGroup(): void {
    this.status =
      this.errors.length > 0 ? LoadStatus.ERROR : LoadStatus.COMPLETE
  }

  public isReadyForCompletion(): boolean {
    return (
      this.readyToComplete && !this.manuallyCompleted && this.manualComplete
    )
  }

  //===============================
  //     ASSET PROCESSING
  //===============================

  /**
   * Recursively calculates total file sizes for this group and its children.
   * This should be called only once at the top level before loading starts.
   */
  private async calculateTotalSizesRecursive(): Promise<number> {
    if (this.sizesInitialised) {
      return this.totalBytes
    }

    const sizePromises = Array.from(this.assets.values()).map(async (item) => {
      try {
        const response = await fetch(item.config.url, { method: "HEAD" })
        const contentLength = Number(response.headers.get("Content-Length"))
        const size = contentLength || 0
        ;(item as any).knownSize = size
        return size
      } catch (error) {
        console.warn(`Could not get size for ${item.config.key}:`, error)
        return 0
      }
    })

    const sizes = await Promise.all(sizePromises)
    const parentTotal = sizes.reduce((acc, size) => acc + size, 0)

    let childrenTotal = 0
    for (const child of this.children) {
      const childTotal = await child.calculateTotalSizesRecursive()
      childrenTotal += childTotal
    }

    this.totalBytes = parentTotal + childrenTotal

    this.sizesInitialised = true

    return this.totalBytes
  }

  private getBlobCacheKey(assetKey: string): string {
    return `blob-store__${assetKey}`
  }

  private getCachedImageBlobUrl: (key: string) => Promise<string | null> =
    async (key) => {
      const blobUrl = this.preferenceManager.getPreference(
        this.getBlobCacheKey(key),
        null
      )

      if (!blobUrl || typeof blobUrl !== "string") {
        return null
      }

      const isValid = await this.isImageBlobUrlValid(blobUrl)

      if (!isValid) {
        this.preferenceManager.removePreference(this.getBlobCacheKey(key))
        return null
      }

      return blobUrl
    }

  private isImageBlobUrlValid = async (blobUrl: string): Promise<boolean> => {
    try {
      const img = new Image()

      const isValid = await Promise.race([
        new Promise<boolean>((resolve) => {
          img.onload = () => resolve(true)
          img.onerror = () => resolve(false)
          img.src = blobUrl
        }),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 100)
        ),
      ])

      img.src = ""
      img.onload = null
      img.onerror = null

      return isValid
    } catch (error) {
      return false
    }
  }

  private loadAsset: (key: string, item: AssetLoadItem) => Promise<void> =
    async (key, item) => {
      if (
        item.status === LoadStatus.LOADING ||
        item.status === LoadStatus.COMPLETE
      ) {
        debug(`Asset ${key} already loading or loaded, skipping`, "asset-skip")
        return
      }

      item.status = LoadStatus.LOADING
      debug(`Loading asset: ${key} (${item.config.type})`, "asset-start")

      try {
        // Try blob URL for images
        if (item.config.type === "image") {
          const foundBlob = await this.loadAssetFromCachedBlob(key, item)
          if (foundBlob) return
        }

        // Try IndexedDB if enabled
        if (this.useIndexDb) {
          const indexedBuffer = await this.fetchAssetFromIndex(key, item)
          if (indexedBuffer) return
        }
      } catch (error) {
        debug(
          `Cache retrieval failed for ${key}, falling back to network: ${error}`,
          "asset-cache"
        )
      }

      // Fall back to network fetch
      await this.fetchAsset(key, item)
    }

  private fetchAssetFromIndex: (
    key: string,
    item: AssetLoadItem
  ) => Promise<boolean> = async (key, item) => {
    try {
      const buffer = (await this.dbManager.read(key)) as ArrayBuffer

      // Validate buffer exists and has data
      if (!buffer || buffer.byteLength === 0) {
        debug(`Invalid buffer in IndexedDB for ${key}`, "asset-cache-invalid")
        return false
      }

      this.completeAssetLoad(
        key,
        item,
        buffer,
        "indexDB store",
        buffer.byteLength
      )

      return true
    } catch (error) {
      debug(`IndexedDB read failed for ${key}: ${error}`, "asset-cache-error")
      return false
    }
  }

  private loadAssetFromCachedBlob: (
    key: string,
    item: AssetLoadItem
  ) => Promise<boolean> = async (key, item) => {
    try {
      const blobUrl = await this.getCachedImageBlobUrl(key)
      if (blobUrl && typeof blobUrl === "string") {
        console.log("blob: ", blobUrl)
        this.completeAssetLoad(key, item, { blobUrl }, "blob store")
        return true
      }
      return false
    } catch (error) {
      debug(
        `Blob URL retrieval failed for ${key}: ${error}`,
        "asset-cache-error"
      )
      return false
    }
  }

  private fetchAsset: (key: string, item: AssetLoadItem) => Promise<void> =
    async (key, item) => {
      let retryCount = 0
      while (retryCount <= this.maxRetries) {
        try {
          const data = await this.fetchAssetData(key, item.config.url)

          this.completeAssetLoad(key, item, data, "remote")

          if (this.useIndexDb) {
            this.dbManager.write(key, data).catch((error) => {
              debug(
                `Failed to cache ${key} to IndexedDB: ${error}`,
                "asset-cache"
              )
            })
          }

          return
        } catch (error) {
          retryCount++
          if (retryCount <= this.maxRetries) {
            debug(
              `Retrying asset: ${key} (attempt ${retryCount}/${this.maxRetries})`,
              "asset-retry"
            )
            await new Promise((resolve) => setTimeout(resolve, this.retryDelay))
          } else {
            this.handleAssetError(key, item, error as Error)
            throw error
          }
        }
      }
    }

  private completeAssetLoad(
    key: string,
    item: AssetLoadItem,
    data: any,
    source: string,
    cachedBytes?: number
  ): void {
    const loadedAsset: LoadedAsset = {
      key,
      type: item.config.type,
      data,
      options: item.config.options,
    }

    if (cachedBytes && cachedBytes > 0) {
      this.updateLoadProgress(cachedBytes)
    }

    this.atomicAddLoadedAsset(loadedAsset)
    item.status = LoadStatus.COMPLETE
    debug(`Asset loaded from ${source}: ${key}`, "asset-complete")
  }

  private fetchAssetData: (id: string, url: string) => Promise<any> = async (
    id,
    url
  ) => {
    const response = await fetch(url)
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []

    if (!reader) {
      throw new Error("Failed to get reader for response body")
    }

    let receivedLength = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      receivedLength += value.length
      this.updateLoadProgress(value.length)
    }

    const chunksAll = new Uint8Array(receivedLength)
    let position = 0
    for (const chunk of chunks) {
      chunksAll.set(chunk, position)
      position += chunk.length
    }

    return this.processAssetData(chunksAll, id)
  }

  private processAssetData: (data: Uint8Array, id: string) => Promise<any> =
    async (data, id) => {
      const asset = this.assets.get(id)
      if (!asset) throw new Error(`Asset not found: ${id}`)

      switch (asset.config.type) {
        case AssetType.MODEL:
        case AssetType.AUDIO:
        case AssetType.SPLAT:
        case AssetType.TEXTURE:
        case AssetType.HDRI:
        case AssetType.IMAGE:
          return data.buffer

        default:
          throw new Error(`Unsupported asset type: ${asset.config.type}`)
      }
    }

  private atomicAddLoadedAsset: (asset: LoadedAsset) => void = (asset) => {
    this.loadedAssets.push(asset)
    if (this.onAssetLoaded) {
      this.onAssetLoaded(asset, this)
    }
    this.handleChildProgress()
  }

  public getAssets: () => Map<string, AssetLoadItem> = () => {
    return this.assets
  }

  //===============================
  //    PROGRESS TRACKING
  //===============================

  public getProgress: () => LoadProgress = () => {
    const { totalLoadedAssets, totalAssets, totalBytesLoaded, totalBytes } =
      this.calculateAggregatedStats()

    const etr = this.calculateAggregateETR()

    return {
      groupName: this.name,
      loaded: totalLoadedAssets,
      total: totalAssets,
      percentage: totalBytes > 0 ? (totalBytesLoaded / totalBytes) * 100 : 0,
      currentAsset: this.getCurrentLoadingAsset(),
      bytesLoaded: totalBytesLoaded,
      totalBytes: totalBytes,
      currentSpeed: this.calculateAggregateCurrentSpeed(),
      averageSpeed: this.calculateAggregateAverageSpeed(),
      estimatedTimeRemaining: etr.raw,
      stableEstimatedTimeRemaining: etr.stable,
    }
  }

  private getCurrentLoadingAsset: () => string | undefined = () => {
    const loadingAsset = Array.from(this.assets.entries()).find(
      ([, item]) => item.status === LoadStatus.LOADING
    )
    if (loadingAsset) return loadingAsset[0]

    for (const child of this.children) {
      const childProgress = child.getProgress()
      if (childProgress.currentAsset) {
        return childProgress.currentAsset
      }
    }

    return undefined
  }

  private updateLoadProgress(bytesLoaded: number) {
    this.loadedBytes += bytesLoaded
    const now = performance.now()

    // Only record a measurement if enough time has passed since the last one
    if (now - this.lastSpeedMeasurementTime >= this.speedUpdateInterval) {
      this.recordSpeedMeasurement(now)
      this.lastSpeedMeasurementTime = now

      // After recording a new measurement, you can recalculate progress if needed
      this.handleChildProgress()
    }
  }

  private recordSpeedMeasurement(now: number) {
    // Push a new measurement
    this.speedMeasurements.push({ timestamp: now, bytes: this.loadedBytes })

    // Trim to desired sample size
    if (this.speedMeasurements.length > this.speedSampleSize) {
      this.speedMeasurements.shift()
    }
  }

  private calculateCurrentSpeed(): number {
    if (this.speedMeasurements.length < 2) {
      return 0
    }

    const oldest = this.speedMeasurements[0]
    const newest = this.speedMeasurements[this.speedMeasurements.length - 1]

    const timespan = (newest.timestamp - oldest.timestamp) / 1000
    const bytesInPeriod = newest.bytes - oldest.bytes

    // If timespan is zero or bytesInPeriod is zero, speed is zero
    return timespan > 0 ? bytesInPeriod / timespan : 0
  }

  private calculateAverageSpeed(): number {
    if (this.loadStartTime === 0) return 0
    const totalTime = (performance.now() - this.loadStartTime) / 1000
    return totalTime > 0 ? this.loadedBytes / totalTime : 0
  }

  // @ts-expect-error - Might be used in future implementation
  private calculateEstimatedTimeRemaining(currentSpeed: number): number {
    if (currentSpeed === 0) return Infinity
    const remainingBytes = this.totalBytes - this.loadedBytes
    return (remainingBytes / currentSpeed) * 1000
  }

  private calculateAggregatedStats() {
    const parentLoadedCount = this.loadedAssets.length
    const parentTotalCount = this.assets.size
    const parentBytesLoaded = this.loadedBytes
    const parentTotalBytes = this.totalBytes

    let childrenLoadedCount = 0
    let childrenTotalCount = 0
    let childrenBytesLoaded = 0

    for (const child of this.children) {
      const cProgress = child.getProgress()
      childrenLoadedCount += cProgress.loaded
      childrenTotalCount += cProgress.total
      childrenBytesLoaded += cProgress.bytesLoaded || 0
    }

    const totalLoadedAssets = parentLoadedCount + childrenLoadedCount
    const totalAssets = parentTotalCount + childrenTotalCount
    const totalBytesLoaded = parentBytesLoaded + childrenBytesLoaded
    const totalBytes = parentTotalBytes

    return {
      totalLoadedAssets,
      totalAssets,
      totalBytesLoaded,
      totalBytes,
    }
  }

  private calculateAggregateCurrentSpeed(): number {
    const parentSpeed = this.calculateCurrentSpeed()

    let totalSpeedWeighted = parentSpeed * this.loadedBytes
    let totalBytesForSpeed = this.loadedBytes

    for (const child of this.children) {
      const cProgress = child.getProgress()
      const cCurrentSpeed = cProgress.currentSpeed || 0
      const cBytesLoaded = cProgress.bytesLoaded || 0

      totalSpeedWeighted += cCurrentSpeed * cBytesLoaded
      totalBytesForSpeed += cBytesLoaded
    }

    if (totalBytesForSpeed === 0) {
      return 0
    }

    const finalSpeed = totalSpeedWeighted / totalBytesForSpeed

    return finalSpeed
  }

  private calculateAggregateAverageSpeed(): number {
    const parentAvg = this.calculateAverageSpeed()
    let totalAvgWeighted = parentAvg * this.loadedBytes
    let totalBytesForAvg = this.loadedBytes

    for (const child of this.children) {
      const cProgress = child.getProgress()
      const cAvg = cProgress.averageSpeed || 0
      const cBytesLoaded = cProgress.bytesLoaded || 0
      totalAvgWeighted += cAvg * cBytesLoaded
      totalBytesForAvg += cBytesLoaded
    }

    if (totalBytesForAvg === 0) return 0
    return totalAvgWeighted / totalBytesForAvg
  }

  private calculateStableETR(currentETR: number): number {
    // If there's no history yet, use current
    if (this.lastETRs.length === 0) {
      this.lastETRs.push(currentETR)
      return currentETR
    }

    const currentStableETR = this.lastETRs[0]

    // If new ETR is less, clear history and use it
    if (currentETR < currentStableETR) {
      this.lastETRs = [currentETR]
      return currentETR
    }

    // Check if increase is significant enough to override immediately
    const percentIncrease = (currentETR - currentStableETR) / currentStableETR
    if (percentIncrease > this.etrStabilityThreshold) {
      this.lastETRs = [currentETR]
      return currentETR
    }

    // Add to history if it's higher
    if (currentETR > currentStableETR) {
      this.lastETRs.push(currentETR)

      // If history is full of higher values, use the new one
      if (this.lastETRs.length >= this.etrHistorySize) {
        const allHigher = this.lastETRs.every((etr) => etr > currentStableETR)
        if (allHigher) {
          this.lastETRs = [currentETR]
          return currentETR
        }
      }

      // Keep history at size limit
      if (this.lastETRs.length > this.etrHistorySize) {
        this.lastETRs.shift()
      }
    }

    // Return current stable ETR
    return currentStableETR
  }

  private calculateAggregateETR(): { raw: number; stable: number } {
    const currentSpeed = this.calculateAggregateCurrentSpeed()
    if (currentSpeed === 0) return { raw: Infinity, stable: Infinity }
    const { totalBytes, totalBytesLoaded } = this.calculateAggregatedStats()
    const remainingBytes = totalBytes - totalBytesLoaded
    const rawETR = (remainingBytes / currentSpeed) * 1000
    const stableETR = this.calculateStableETR(rawETR)
    return { raw: rawETR, stable: stableETR }
  }

  private handleChildProgress() {
    if (!this.onProgress) return

    const now = performance.now()
    if (now - this.lastProgressUpdateTime < this.progressUpdateInterval) {
      return
    }

    const progress = this.getProgress()
    this.onProgress(progress, this)
    this.lastProgressUpdateTime = now
  }

  public getLoadDuration: () => number = () => {
    if (this.loadStartTime === 0) return 0
    const endTime = this.loadEndTime || performance.now()
    return endTime - this.loadStartTime
  }

  //===============================
  //      ERROR HANDLING
  //===============================

  private handleAssetError: (
    id: string,
    item: AssetLoadItem,
    error: Error
  ) => void = (id, item, error) => {
    item.status = LoadStatus.ERROR
    this.errors.push({
      assetId: id,
      type: item.config.type,
      error,
      attempts: item.attempts,
    })
    if (this.onError) {
      this.onError(this.errors, this)
    }
  }

  public getErrors: () => LoadError[] = () => {
    return this.errors
  }

  public getStatus: () => LoadStatus = () => {
    if (this.manualComplete && !this.manuallyCompleted) {
      return LoadStatus.LOADING
    }
    return this.status
  }

  //===============================
  //    RESOURCE MANAGEMENT
  //===============================

  public cleanup: (delay?: number) => void = (delay = 500) => {
    debug(
      `Cleanup scheduled for load group "${this.getName()}" in ${delay}ms`,
      "cleanup-schedule"
    )

    setTimeout(() => {
      this.loadedAssets.forEach((asset) => {
        if (this.processedAssets.has(asset.key)) {
          debug(`Cleaning up asset: ${asset.key}`, "cleanup-asset")
          switch (asset.type) {
            case AssetType.IMAGE:
              if (asset.data instanceof ImageBitmap) {
                asset.data.close()
                asset.data = null
              }
              asset.data = null

              break

            case AssetType.SPLAT:
            case AssetType.MODEL:
            case AssetType.AUDIO:
              asset.data = null
              break

            case AssetType.TEXTURE:
            case AssetType.HDRI:
              if (asset.data instanceof Blob) {
                URL.revokeObjectURL(URL.createObjectURL(asset.data))
              }
              break
          }
        }
      })

      // this.loadedAssets = []
      this.processedAssets.clear()

      this.parentGroup = null

      this.children.forEach((child) => child.cleanup(delay))
      debug(
        `Load group "${this.getName()}" assets cleaned up.`,
        "cleanup-complete"
      )
    }, delay)
  }

  //===============================
  //         UTILITIES
  //===============================

  /**
   * Returns the name of the load group
   */

  public getName: () => string = () => {
    return this.name
  }

  /**
   * Returns the priority level of the load group
   * Note: Higher numbers indicate higher priority
   */

  public getPriority: () => number = () => {
    return this.priority
  }

  public getLoadedAssets(): LoadedAsset[] {
    return this.loadedAssets
  }

  // @ts-expect-error - Might be used in future implementation
  private getAggregateBytesLoaded(): number {
    const { totalBytesLoaded } = this.calculateAggregatedStats()
    return totalBytesLoaded
  }

  public outputDebug(message: string = "", indent: string = ""): string {
    let output = ""

    if (message) {
      output += `${indent}${message}\n`
    }

    // Group header
    output += `${indent}LoadGroup: ${this.getName()}\n`
    output += `${indent}Status: ${this.getStatus()}\n`

    // Get progress info
    const progress = this.getProgress()
    output += `${indent}Progress: ${progress.percentage.toFixed(2)}%\n`
    output += `${indent}Assets Loaded: ${progress.loaded}/${progress.total}\n`
    output += `${indent}Bytes: ${progress.bytesLoaded}/${progress.totalBytes}\n`

    // Current loading asset
    if (progress.currentAsset) {
      output += `${indent}Currently Loading: ${progress.currentAsset}\n`
    }

    // Asset details
    const assets = this.getAssets()
    if (assets.size > 0) {
      output += `${indent}Assets:\n`
      assets.forEach((item, id) => {
        output += `${indent}  - ${id} (${item.config.type}): ${item.status}\n`
      })
    }

    // Error details
    const errors = this.getErrors()
    if (errors.length > 0) {
      output += `${indent}Errors:\n`
      errors.forEach((error) => {
        output += `${indent}  - ${error.assetId}: ${error.error.message} (${error.attempts} attempts)\n`
      })
    }

    // Manual completion status
    if (this.isReadyForCompletion()) {
      output += `${indent}WARNING: Group requires manual completion and is ready but not completed\n`
    }

    // Child groups
    if (this.children.length > 0) {
      output += `${indent}Child Groups:\n`
      this.children.forEach((child) => {
        output += child.outputDebug("", indent + "  ")
      })
    }

    return output
  }
}
