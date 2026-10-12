export interface AssetCacheConfig {
  /** IndexedDB database and store that fetched buffers are written to. `false` disables it. */
  db?: { name: string; store: string } | false
}

export const DEFAULT_CACHE: Required<AssetCacheConfig> = {
  db: { name: "assets-db", store: "asset-store" },
}

const blobUrls = new Map<string, string>()

/** Blob URLs only live for the page, so they're tracked in memory rather than storage. */
export const blobUrlStore = {
  get: (key: string): string | undefined => blobUrls.get(key),
  set: (key: string, url: string): void => {
    blobUrlStore.remove(key)
    blobUrls.set(key, url)
  },
  remove: (key: string): void => {
    const url = blobUrls.get(key)
    if (url) URL.revokeObjectURL(url)
    blobUrls.delete(key)
  },
}
