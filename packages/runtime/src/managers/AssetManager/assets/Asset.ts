import { debug } from "../../../utils"
import type AssetManager from "../AssetManager"
import LoadGroup from "../LoadGroup"
import type { LoadGroupConfig, LoadedAsset, LoadProgress } from "../LoadGroup"
import { ResourceType } from "../types"
import { getObjPathByValue } from "../../../utils/debug/general"

type NestedStringArray =
  | string
  | string[]
  | { [key: string]: NestedStringArray }

export interface ResourceLoadConfig {
  key: string
  type: ResourceType
  url: string
  options?: any
  priority?: number
}

export interface AssetOptions {
  key: string
  manager?: AssetManager
  resources?: ResourceLoadConfig[] | ResourceLoadConfig | string[] | string
  children?: string[] | string | NestedStringArray
  verification?: () => boolean
}

export interface LoadConfig {
  onComplete?: (assets?: LoadedAsset[], loadGroup?: LoadGroup) => void
  onProgress?: (progress: LoadProgress, group: LoadGroup) => void
}

export const AssetLoadStatus = {
  UNLOADED: "unloaded",
  LOADED: "loaded",
} as const

export type AssetLoadStatus =
  (typeof AssetLoadStatus)[keyof typeof AssetLoadStatus]

export class Asset {
  private _key: string
  private _status: AssetLoadStatus = AssetLoadStatus.UNLOADED
  private _resources: (ResourceLoadConfig | string)[]
  private _childrenKeys: string[]
  private _children: Asset[] = []
  private _object: any | null = null
  private customVerification: (() => boolean) | null = null
  private _manager: AssetManager | null = null
  private childrenStruct: NestedStringArray | null = null
  private structuredChildren: any
  public resourceBuffers: Map<string, ArrayBuffer> = new Map()
  protected readonly resourceLimit: number = 0
  protected readonly allowedResourceTypes: ResourceType[] = []

  get key(): string {
    return this._key
  }

  get status(): AssetLoadStatus {
    return this._status
  }

  get isLoaded(): boolean {
    return this._status === AssetLoadStatus.LOADED
  }

  get resources(): (ResourceLoadConfig | string)[] {
    return this._resources
  }

  get children(): Asset[] {
    if (this._children.length === this._childrenKeys.length) {
      return this._children
    }

    this._children = []
    for (const key of this._childrenKeys) {
      const childAsset = this.manager?.get(key)
      if (!childAsset) {
        debug(`Asset not found in manager register: ${key}`, "error")
        continue
      }
      this._children.push(childAsset)
    }
    return this._children
  }

  get childrenGrouped(): any {
    if (this.structuredChildren) {
      return this.structuredChildren
    }

    if (!this.childrenStruct) {
      return this.children
    }

    const structuredChildren: any = {}

    for (const key of this._childrenKeys) {
      const childAsset = this.manager?.get(key)
      if (!childAsset) continue

      const path = getObjPathByValue(this.childrenStruct, key)
      if (!path) continue

      let current = structuredChildren
      for (let j = 0; j < path.length; j++) {
        const segment = path[j]
        const isLast = j === path.length - 1

        if (isLast) {
          if (!current[segment]) current[segment] = []
          current[segment].push(childAsset)
        } else {
          if (!current[segment]) current[segment] = {}
          current = current[segment]
        }
      }
    }

    this.structuredChildren = structuredChildren
    return this.structuredChildren
  }

  get childrenKeys(): (ResourceLoadConfig | string)[] {
    return this._childrenKeys
  }

  set manager(assetManager: AssetManager) {
    this._manager = assetManager
  }

  get manager(): AssetManager | null {
    return this._manager
  }

  public getResourceBuffer(): Array<{ key: string; buffer: ArrayBuffer }> {
    return Array.from(this.resourceBuffers.entries()).map(([key, buffer]) => ({
      key,
      buffer,
    }))
  }

  constructor(opts: AssetOptions) {
    this._key = opts.key
    this._resources = opts.resources
      ? Array.isArray(opts.resources)
        ? opts.resources
        : [opts.resources]
      : []

    this._childrenKeys = opts.children
      ? typeof opts.children === "object"
        ? this.unpackChildrenObject(opts.children)
        : Array.isArray(opts.children)
        ? opts.children
        : [opts.children]
      : []

    if (opts?.verification) this.customVerification = opts.verification
  }

  private unpackChildrenObject(childrenObj: NestedStringArray): string[] {
    this.childrenStruct = childrenObj
    return Object.values(childrenObj).flat(Infinity) as string[]
  }

  // Verification

  protected _verify(): boolean {
    return this?._object ? true : false
  }

  public verify(): boolean {
    return this?.customVerification ? this.customVerification() : this._verify()
  }

  public setVerificationCheck(func: () => boolean): void {
    this.customVerification = func
  }

  // Load group

  public generateLoadGroup(config?: LoadConfig): LoadGroupConfig | null {
    if (!this.manager) return null
    let children: LoadGroupConfig[] = []
    this.children.forEach((child) => {
      const cLoadGroup = child?.generateLoadGroup()
      if (!cLoadGroup) return
      children.push(cLoadGroup)
    })
    const lg: LoadGroupConfig = {
      name: `${this._key}__load-group`,
      assets: this.manager.parseResources(this._resources),
      children,
      onProgress: config?.onProgress,
      onComplete: async (assets: LoadedAsset[], loadGroup: LoadGroup) => {
        assets.forEach((a) => {
          this.resourceBuffers.set(a.key, a.data)
          a.data = null
        })
        if (config?.onComplete) config.onComplete(assets, loadGroup)
        loadGroup.cleanup()
      },
    }
    return lg
  }

  public async load(config?: LoadConfig): Promise<void> {
    if (!this.manager) {
      debug("This asset doesn't have a registered manager.", "error")
    }
    const lgConfig: LoadGroupConfig | null = this.generateLoadGroup(config)
    if (!lgConfig) return
    const lg: LoadGroup = new LoadGroup(lgConfig)
    await lg.load()
  }

  public process(): any {
    debug(
      "Generic assets don't have a built-in process function. You need to do something with them so that they can be used."
    )
  }

  public releaseBuffers(): void {
    this.resourceBuffers.clear()
  }

  public cleanup(): void {
    this.releaseBuffers()
  }

  // Resource Validation

  public validateResourceLimit(): boolean {
    return this.resourceLimit
      ? this.resourceLimit >= this.resources.length
      : true
  }

  public validateResourceTypes(): boolean {
    // Check if all resource types are allowed
    if (!this.allowedResourceTypes.length) return true

    if (!this?.manager) {
      debug(
        `This asset (${this.key}) doesn't have a registered manager.`,
        "error"
      )
      return false
    }

    let isValid = true

    this.resources.forEach((r) => {
      const resourceType =
        typeof r === "string" ? this.manager?.resources.get(r)?.type : r.type

      if (!resourceType) {
        debug(
          `Resource "${r}" is missing from registry for asset "${this.key}"`,
          "error"
        )
        isValid = false
      } else {
        if (!this.allowedResourceTypes.includes(resourceType)) {
          debug(
            [
              `Resource "${r}" of type ${resourceType} is not allowed on asset "${this.constructor.name}". Allowed types: `,
              this.allowedResourceTypes,
            ],
            "error"
          )
          isValid = false
        }
      }
    })

    return isValid
  }

  public validateResources(): boolean {
    if (!this.validateResourceLimit()) {
      debug(
        `Asset ${this.key} has too many resources. ${this.resources.length} (${this.resourceLimit} max)`,
        "error"
      )
      return false
    }

    if (!this.validateResourceTypes()) return false

    return true
  }
}

export default Asset
