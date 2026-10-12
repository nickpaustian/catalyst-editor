import { Asset, type AssetOptions } from "./Asset"
import { ResourceType } from "../ResourceType"
import { decodeText } from "../utils"

export interface TextAssetOptions extends AssetOptions {}

/** HTML, CSS or any other text file. */
export class TextAsset extends Asset {
  protected readonly resourceLimit: number = 1
  protected readonly allowedResourceTypes: ResourceType[] = [ResourceType.TEXT]
  private decoded: string | null = null

  constructor(opts: TextAssetOptions) {
    super(opts)
  }

  public get text(): string {
    if (this.decoded === null) {
      this.decoded = decodeText(this.getResourceBuffer()[0].buffer)
    }
    return this.decoded
  }

  public override process(): string {
    return this.text
  }

  public override release(options = {}): void {
    this.decoded = null
    super.release(options)
  }
}

export default TextAsset
