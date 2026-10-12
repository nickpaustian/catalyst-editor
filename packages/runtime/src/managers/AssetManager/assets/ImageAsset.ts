import { Asset, type AssetOptions } from "./Asset"
import { ResourceType } from "../types"
import { decodeToDataURL } from "../utils"

export interface ImageAssetOptions extends AssetOptions {}

export class ImageAsset extends Asset {
  protected readonly resourceLimit: number = 1
  protected readonly allowedResourceTypes: ResourceType[] = [ResourceType.IMAGE]

  constructor(opts: ImageAssetOptions) {
    super(opts)
  }

  public process(): string {
    return decodeToDataURL(this.getResourceBuffer()[0])
  }
}

export default ImageAsset
