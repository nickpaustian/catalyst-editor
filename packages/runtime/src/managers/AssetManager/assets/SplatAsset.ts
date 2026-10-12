import * as THREE from "three"

import { Asset, type AssetOptions } from "./Asset"
import { ResourceType } from "../types"
import { debug } from "../../../utils"
import { type SplatOptions } from "../../../types"
import { SplatMesh } from "@sparkjsdev/spark"

export interface SplatAssetOptions extends AssetOptions {}

interface processSplatOptions {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
}

export class SplatAsset extends Asset {
  protected readonly resourceLimit: number = 1
  protected readonly allowedResourceTypes: ResourceType[] = [ResourceType.SPLAT]

  constructor(opts: SplatAssetOptions) {
    super(opts)
  }

  public get buffer(): ArrayBuffer {
    return this.getResourceBuffer()[0].buffer
  }

  public async processSplat(opts: processSplatOptions): Promise<any> {
    debug("Starting splat load from buffer")

    const { scene, camera, renderer } = opts

    if (!scene || !camera || !renderer || !this.buffer) return

    const splatMesh = await this.loadSplatFromBuffer(this.buffer, {
      onReady: () => {
        debug("Splat scene ready (from buffer)")
      },
      onError: (error) => {
        console.error("Error loading splat from buffer:", error)
      },
    })

    return splatMesh
  }

  private async loadSplatFromBuffer(
    _splatBufferArray: ArrayBuffer,
    options: SplatOptions = {}
  ): Promise<any> {
    const {
      position = [0, 0, 0],
      rotation = [0, 0, 1, 0],
      scale = [6.5, 6.5, 6.5],
      onReady = null,
      onError = null,
      maxRetries = 3,
      retryDelay = 2000,
    } = options

    // Function to perform the actual loading process
    const performLoad = async (): Promise<any> => {
      try {
        // Create a SplatMesh directly from the ArrayBuffer
        const splatMesh = new SplatMesh({
          url: "https://slv-image-delivery.s3.amazonaws.com/v-exhibitions/media/other/177251409457c/beruk-large-trimmed.sog",
          // fileBytes: splatBufferArray,
          // fileType can be optionally specified if auto-detection fails
          // fileType: SplatFileType.PCSOGS, // 'PLY', 'SPLAT', 'KSPLAT', 'SPZ'
        })

        // Set position, rotation, and scale
        splatMesh.position.set(position[0], position[1], position[2])

        // Handle rotation
        if (rotation.length === 4) {
          splatMesh.quaternion.set(
            rotation[0],
            rotation[1],
            rotation[2],
            rotation[3]
          )
        }

        const uniformScale = Array.isArray(scale) ? scale[0] : scale
        splatMesh.scale.setScalar(uniformScale)

        if (onReady) {
          setTimeout(() => {
            onReady()
          }, 100)
        }

        return splatMesh
      } catch (error) {
        console.error("SPLAT - Failed to create SplatMesh from buffer:", error)
        throw error
      }
    }

    let lastError: any = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await performLoad()
        return result
      } catch (error) {
        lastError = error

        if (attempt < maxRetries) {
          debug(`Splat load attempt ${attempt} failed, retrying...`)
          await new Promise((resolve) => setTimeout(resolve, retryDelay))
        }
      }
    }

    if (onError) onError(lastError)

    // Return null to indicate failure, allowing the caller to implement a fallback
    return null
  }
}

export default SplatAsset
