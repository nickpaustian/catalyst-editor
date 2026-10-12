import { debug } from "@vitrine/debug"
import Asset, { type ResourceLoadConfig, type AssetStatus } from "./assets/Asset"
import ResourceManager from "./ResourceManager"
import { isString } from "./utils"
import { DEFAULT_CACHE, type AssetCacheConfig } from "./cache"
import DBManager from "./DBManager"

export interface AssetManagerOptions {
  cache?: AssetCacheConfig
}

export interface AssetInventoryEntry {
  key: string
  type: string
  status: AssetStatus
  ready: boolean
  treeReady: boolean
  /** Every resource of this asset is in the IndexedDB cache. */
  cached: boolean
  children: string[]
}

/**
 * Registry of asset stubs. Lives for the whole page: stubs survive an
 * exhibition being torn down, so a later ensure() knows what it already has.
 */
export class AssetManager {
  private assets: Map<string, Asset> = new Map()
  public resources: ResourceManager
  public readonly cache: Required<AssetCacheConfig>
  private db: DBManager | null = null

  constructor(options: AssetManagerOptions = {}) {
    debug("Asset Manager initialised", "asset-manager")
    this.resources = new ResourceManager()
    this.cache = { ...DEFAULT_CACHE, ...options.cache }
    if (this.cache.db) {
      this.db = new DBManager(this.cache.db.name, this.cache.db.store)
      void this.db.init()
    }
  }

  register(asset: Asset | Asset[]): void {
    const assetsToRegister = Array.isArray(asset) ? asset : [asset]

    assetsToRegister.forEach((a) => {
      a.manager = this

      if (!a.validateResources()) return

      if (this.assets.has(a.key)) {
        debug(
          `Asset with key "${a.key}" already registered, overwriting`,
          "asset-manager"
        )
      }

      this.assets.set(a.key, a)
      debug(`Registered asset: ${a.key}`, "asset-manager")
    })
  }

  /** Register unless a stub with this key exists; returns the registered stub either way. */
  registerOrGet<T extends Asset>(asset: T): T {
    const existing = this.assets.get(asset.key)
    if (existing) return existing as T
    this.register(asset)
    return asset
  }

  get(key: string): Asset | undefined {
    return this.assets.get(key)
  }

  getAs<T extends Asset>(key: string): T | undefined {
    return this.assets.get(key) as T | undefined
  }

  has(key: string): boolean {
    return this.assets.has(key)
  }

  /** Shorthand for `get(key).ensure()`. */
  async ensure<T extends Asset>(key: string): Promise<T> {
    const asset = this.assets.get(key)
    if (!asset) throw new Error(`Asset "${key}" is not registered`)
    return (await asset.ensure()) as T
  }

  release(key: string, deep = true): void {
    this.assets.get(key)?.release({ deep })
  }

  unregister(key: string): boolean {
    const removed = this.assets.delete(key)
    if (removed) {
      debug(`Unregistered asset: ${key}`, "asset-manager")
    }
    return removed
  }

  getAllKeys(): string[] {
    return Array.from(this.assets.keys())
  }

  getAssetCount(): number {
    return this.assets.size
  }

  public parseResources(
    resources: (ResourceLoadConfig | string)[]
  ): ResourceLoadConfig[] {
    return resources
      .map((r) => {
        if (isString(r)) {
          const resource = this.resources.get(r as string)
          if (!resource) {
            debug(`Resource "${r}" not found.`, "error")
            return null
          }
          return resource
        }
        return r
      })
      .filter((r): r is ResourceLoadConfig => r !== null)
  }

  /** True when every resource of the asset is in the IndexedDB cache. */
  public async isCached(key: string): Promise<boolean> {
    const asset = this.assets.get(key)
    if (!asset || !this.db) return false
    await this.db.ready
    const resources = this.parseResources(asset.resources)
    if (resources.length === 0) return true
    const checks = await Promise.all(resources.map((r) => this.db!.has(r.key)))
    return checks.every(Boolean)
  }

  /** What's registered and what state it's in, for one subtree or everything. */
  public async inventory(rootKey?: string): Promise<AssetInventoryEntry[]> {
    const root = rootKey ? this.assets.get(rootKey) : undefined
    const assets = root ? root.walk() : Array.from(this.assets.values())
    return Promise.all(
      assets.map(async (asset) => ({
        key: asset.key,
        type: asset.constructor.name,
        status: asset.status,
        ready: asset.isReady,
        treeReady: asset.isTreeReady,
        cached: await this.isCached(asset.key),
        children: asset.children.map((child) => child.key),
      }))
    )
  }
}

export default AssetManager
