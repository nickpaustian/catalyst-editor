import { debug } from "../../utils"
import Asset, { type ResourceLoadConfig } from "./assets/Asset"
import ResourceManager from "./ResourceManager"
import { isString } from "../../utils/debug"
import BaseManager from "../BaseManager"

export class AssetManager extends BaseManager {
  private assets: Map<string, Asset> = new Map()
  public resources: ResourceManager

  constructor() {
    super()
    debug("Asset Manager initialised", "asset-manager")
    this.resources = new ResourceManager()
  }

  register(asset: Asset | Asset[]): void {
    const assetsToRegister = Array.isArray(asset) ? asset : [asset]

    assetsToRegister.forEach((a) => {
      a.manager = this

      //Check if the asset's resources is below the limit
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

  get(key: string): Asset | undefined {
    return this.assets.get(key)
  }

  has(key: string): boolean {
    return this.assets.has(key)
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
}

export default AssetManager
