import { blobUrlStore } from "./cache"

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
  if (storeKey) blobUrlStore.set(storeKey, blobUrl)
  return blobUrl
}

export const isString = (value: unknown): value is string =>
  typeof value === "string" || value instanceof String

export const getObjPathByValue = (
  obj: any,
  value: string,
  path: string[] = []
): string[] | undefined => {
  for (const [key, val] of Object.entries(obj)) {
    const currentPath = [...path, key]

    if (val === value) return currentPath

    if (Array.isArray(val)) {
      if (val.includes(value)) return currentPath
    } else if (typeof val === "object" && val !== null) {
      const found = getObjPathByValue(val, value, currentPath)
      if (found) return found
    }
  }

  return undefined
}

export const decodeText = (buffer: ArrayBuffer): string =>
  new TextDecoder().decode(buffer)
