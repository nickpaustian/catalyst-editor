import { debug } from "@vitrine/debug"
import type { AssetManager } from "../AssetManager"
import LoadGroup from "../LoadGroup"
import type { LoadGroupConfig, LoadedAsset, LoadProgress } from "../LoadGroup"
import { ResourceType } from "../ResourceType"
import { getObjPathByValue } from "../utils"

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

export interface ReleaseOptions {
  /** Also release every descendant. */
  deep?: boolean
}

export const AssetStatus = {
  /** Registered, never fetched. */
  UNLOADED: "unloaded",
  LOADING: "loading",
  /** Buffers are held and usable. */
  READY: "ready",
  /** Was ready; buffers dropped and can be fetched again with ensure(). */
  RELEASED: "released",
  ERROR: "error",
} as const

export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus]

/**
 * A stub that knows what it needs to fetch and how to prepare it. Register
 * first, then `ensure()` whenever the asset is actually needed: it resolves
 * at once when ready, joins a load in flight, and otherwise fetches from the
 * cache or the network. `release()` drops the buffers but keeps the stub.
 */
export class Asset {
  private _key: string
  private _status: AssetStatus = AssetStatus.UNLOADED
  private _resources: (ResourceLoadConfig | string)[]
  private _childrenKeys: string[]
  private _children: Asset[] = []
  private _object: any | null = null
  private customVerification: (() => boolean) | null = null
  private _manager: AssetManager | null = null
  private childrenStruct: NestedStringArray | null = null
  private structuredChildren: any
  private _inFlight: Promise<void> | null = null
  private _settleInFlight: (() => void) | null = null
  private _failInFlight: ((error: Error) => void) | null = null
  public resourceBuffers: Map<string, ArrayBuffer> = new Map()
  protected readonly resourceLimit: number = 0
  protected readonly allowedResourceTypes: ResourceType[] = []

  get key(): string {
    return this._key
  }

  get status(): AssetStatus {
    return this._status
  }

  /** True when this asset's own resources are held (groups with no resources are trivially ready). */
  get isReady(): boolean {
    return this._resources.length === 0 || this._status === AssetStatus.READY
  }

  /** True when this asset and every descendant is ready. */
  get isTreeReady(): boolean {
    return this.isReady && this.children.every((child) => child.isTreeReady)
  }

  get isLoading(): boolean {
    return this._inFlight !== null
  }

  /** @deprecated use isReady */
  get isLoaded(): boolean {
    return this.isReady
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

  /** Every descendant, depth first, including this asset. */
  public walk(): Asset[] {
    return [this, ...this.children.flatMap((child) => child.walk())]
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

  // Loading

  private beginLoad(): void {
    if (this._inFlight) return
    this._status = AssetStatus.LOADING
    this._inFlight = new Promise<void>((resolve, reject) => {
      this._settleInFlight = resolve
      this._failInFlight = reject
    })
    // A failure is surfaced through ensure(); nothing else awaits this promise
    this._inFlight.catch(() => undefined)
  }

  private endLoad(error?: Error): void {
    this._status = error ? AssetStatus.ERROR : AssetStatus.READY
    const settle = this._settleInFlight
    const fail = this._failInFlight
    this._inFlight = null
    this._settleInFlight = null
    this._failInFlight = null
    if (error) fail?.(error)
    else settle?.()
  }

  /**
   * Load group covering whatever in this subtree isn't ready yet. Returns
   * null when nothing needs fetching.
   */
  public generateLoadGroup(config?: LoadConfig): LoadGroupConfig | null {
    if (!this.manager) return null

    const children: LoadGroupConfig[] = []
    this.children.forEach((child) => {
      const childGroup = child.generateLoadGroup()
      if (childGroup) children.push(childGroup)
    })

    const needsOwnResources = !this.isReady && !this._inFlight
    if (!needsOwnResources && children.length === 0 && !this._inFlight) {
      return null
    }

    if (needsOwnResources) this.beginLoad()

    return {
      name: `${this._key}__load-group`,
      assets: needsOwnResources ? this.manager.parseResources(this._resources) : [],
      children,
      cache: this.manager.cache,
      onProgress: config?.onProgress,
      onComplete: async (assets: LoadedAsset[], loadGroup: LoadGroup) => {
        assets.forEach((a) => {
          this.resourceBuffers.set(a.key, a.data)
          a.data = null
        })
        if (needsOwnResources) this.endLoad()
        if (config?.onComplete) config.onComplete(assets, loadGroup)
        loadGroup.cleanup()
      },
      onError: (errors) => {
        if (needsOwnResources && errors.length > 0) {
          this.endLoad(errors[0].error)
        }
      },
    }
  }

  /** Fetch everything in this subtree that isn't held yet. Prefer ensure(). */
  public async load(config?: LoadConfig): Promise<void> {
    if (!this.manager) {
      debug("This asset doesn't have a registered manager.", "error")
      return
    }
    const lgConfig = this.generateLoadGroup(config)
    if (!lgConfig) {
      config?.onComplete?.([], undefined)
      return
    }
    const lg = new LoadGroup(lgConfig)
    await lg.load()
  }

  /**
   * Resolves with the asset once its subtree is ready: immediately if it is,
   * by joining a load in flight, or by fetching (cache first, then network).
   */
  public async ensure(config?: LoadConfig): Promise<this> {
    if (this.isTreeReady) return this
    if (this._inFlight && this.children.every((child) => child.isTreeReady)) {
      await this._inFlight
      return this
    }
    await this.load(config)
    if (!this.isTreeReady) {
      throw new Error(`Asset ${this._key} did not become ready`)
    }
    return this
  }

  public process(): any {
    debug(
      "Generic assets don't have a built-in process function. You need to do something with them so that they can be used."
    )
  }

  /** Drop held buffers; the stub stays registered and ensure() can refetch. */
  public release(options: ReleaseOptions = {}): void {
    this.resourceBuffers.clear()
    this._object = null
    if (this._status === AssetStatus.READY) {
      this._status = AssetStatus.RELEASED
    }
    if (options.deep) this.children.forEach((child) => child.release(options))
  }

  /** @deprecated use release() */
  public releaseBuffers(): void {
    this.release()
  }

  public cleanup(): void {
    this.release()
  }

  // Resource Validation

  public validateResourceLimit(): boolean {
    return this.resourceLimit
      ? this.resourceLimit >= this.resources.length
      : true
  }

  public validateResourceTypes(): boolean {
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
