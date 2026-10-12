import { Asset, type AssetOptions } from "./Asset"
import { ResourceType } from "../ResourceType"
import { decodeText } from "../utils"

export interface JsonAssetOptions extends AssetOptions {}

export class JsonAsset<T = unknown> extends Asset {
  protected readonly resourceLimit: number = 1
  protected readonly allowedResourceTypes: ResourceType[] = [ResourceType.JSON]
  private parsed: T | null = null

  constructor(opts: JsonAssetOptions) {
    super(opts)
  }

  /** The parsed document. Requires the asset to be ready. */
  public get json(): T {
    if (this.parsed === null) {
      this.parsed = JSON.parse(decodeText(this.getResourceBuffer()[0].buffer)) as T
    }
    return this.parsed
  }

  public override process(): T {
    return this.json
  }

  public override release(options = {}): void {
    this.parsed = null
    super.release(options)
  }
}

export default JsonAsset
