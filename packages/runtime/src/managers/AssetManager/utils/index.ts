import PreferenceManager from "../../PreferenceManager"

type BufferInput =
  | ArrayBuffer
  | { blobUrl: string }
  | { key: string; buffer: ArrayBuffer }
  | { buffer: { blobUrl: string } }

export function decodeToDataURL(
  buffer: BufferInput,
  storeKey?: string,
  mimeType: string = "image/jpeg"
): string {
  //TODO fix this struct so we aren't targeting buffer.buffer.bloburl
  if (
    buffer &&
    typeof buffer === "object" &&
    "buffer" in buffer &&
    buffer.buffer &&
    typeof buffer.buffer === "object" &&
    "blobUrl" in buffer.buffer
  ) {
    return buffer.buffer.blobUrl
  }
  if (typeof buffer === "object" && "blobUrl" in buffer) {
    return buffer.blobUrl
  }
  if (typeof buffer === "object" && "key" in buffer) {
    storeKey = buffer.key
    buffer = buffer.buffer
  }

  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error("Invalid buffer type")
  }

  const blob = new Blob([buffer], { type: mimeType })
  const blobUrl = URL.createObjectURL(blob)
  if (storeKey) storeUrlBlob(storeKey, blobUrl)
  return blobUrl
}

export const storeUrlBlob: (key: string, blobUrl: string) => void = (
  key,
  blobUrl
) => {
  const preferences: PreferenceManager = PreferenceManager.getInstance()
  cleanupBlobUrl(key)
  preferences.setPreference(`blob-store__${key}`, blobUrl)
}

export const cleanupBlobUrl = (key: string) => {
  const preferences = PreferenceManager.getInstance()
  const blobUrl = preferences.getPreference(`blob-store__${key}`)
  if (blobUrl && typeof blobUrl === "string") {
    URL.revokeObjectURL(blobUrl)
    preferences.removePreference(`blob-store__${key}`)
  }
}
