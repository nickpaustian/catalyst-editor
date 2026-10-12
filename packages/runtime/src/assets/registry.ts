import { AssetManager } from "@vitrine/assets"
import { namespace } from "../constants"

/** Page-level registry: stubs outlive the exhibition that registered them. */
export const assets = new AssetManager({
  cache: { db: { name: `${namespace}-db`, store: "asset-store" } },
})
