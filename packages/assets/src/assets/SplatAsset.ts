import { Asset, type AssetOptions } from "./Asset"
import { ResourceType } from "../ResourceType"

export interface SplatAssetOptions extends AssetOptions {}

/** A `.vgsp` partition (or any splat file) held as a buffer for a splat node to consume. */
export class SplatAsset extends Asset {
  protected readonly resourceLimit: number = 1
  protected readonly allowedResourceTypes: ResourceType[] = [ResourceType.SPLAT]

  constructor(opts: SplatAssetOptions) {
    super(opts)
  }

  public get buffer(): ArrayBuffer {
    return this.getResourceBuffer()[0].buffer
  }
}

export default SplatAsset
