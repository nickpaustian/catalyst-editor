import { debug } from "../../utils"
import { type ResourceLoadConfig } from "./assets/Asset"

export class ResourceManager {
  private resources: Map<string, ResourceLoadConfig> = new Map()

  constructor() {
    debug("Resource Manager initialised", "resource-manager")
  }

  register(resources: ResourceLoadConfig | ResourceLoadConfig[]): void {
    const resourcesToRegister = Array.isArray(resources)
      ? resources
      : [resources]

    resourcesToRegister.forEach((r) => {
      if (this.resources.has(r.key)) {
        debug(
          `Resource with key "${r.key}" already registered, overwriting`,
          "resource-manager"
        )
      }

      this.resources.set(r.key, r)
      debug(`Registered resource: ${r.key}`, "resource-manager")
    })
  }

  get(key: string): ResourceLoadConfig | undefined {
    return this.resources.get(key)
  }

  has(key: string): boolean {
    return this.resources.has(key)
  }

  unregister(key: string): boolean {
    const removed = this.resources.delete(key)
    if (removed) {
      debug(`Unregistered resource: ${key}`, "asset-manager")
    }
    return removed
  }

  getAllKeys(): string[] {
    return Array.from(this.resources.keys())
  }

  getAssetCount(): number {
    return this.resources.size
  }
}

export default ResourceManager
