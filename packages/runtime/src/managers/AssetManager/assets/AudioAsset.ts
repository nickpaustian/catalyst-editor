import { Asset, type AssetOptions } from "./Asset"
import { ResourceType } from "../types"
import { decodeToDataURL } from "../utils"

export interface AudioAssetOptions extends AssetOptions {}

export class AudioAsset extends Asset {
  protected readonly resourceLimit: number = 1
  protected readonly allowedResourceTypes: ResourceType[] = [ResourceType.AUDIO]

  constructor(opts: AudioAssetOptions) {
    super(opts)
  }

  public process(): string {
    return decodeToDataURL(this.getResourceBuffer()[0])
  }

  public get buffer(): ArrayBuffer {
    return this.getResourceBuffer()[0].buffer
  }
}

export default AudioAsset
