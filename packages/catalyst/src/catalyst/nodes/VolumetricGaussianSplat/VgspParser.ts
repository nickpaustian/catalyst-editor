/**
 * Parser for .vgsp (VGS Partition) binary bundle files.
 *
 * Format:
 *   [4 bytes]  magic "VGSP"
 *   [4 bytes]  version = 1
 *   [4 bytes]  num_files
 *   for each file entry:
 *     [2 bytes]  cell_id string length
 *     [N bytes]  cell_id string (e.g. "5_3_2" or "4_0_0@4")
 *     [1 byte]   slice index (0-4)
 *     [4 bytes]  byte offset into data section
 *     [4 bytes]  byte length
 *   [data section — concatenated raw slice files]
 */

const MAGIC = "VGSP"
const VERSION = 1

export interface VGSPEntry {
  cellId: string
  slice: number
  offset: number
  length: number
}

export interface VGSPBundle {
  entries: VGSPEntry[]
  data: ArrayBuffer
}

/**
 * Parse a .vgsp binary bundle into a map of cellId:slice -> ArrayBuffer.
 * Returns a Map ready to use as _bundleCache in VolumetricGaussianSplat.
 */
export function parseVGSP(buffer: ArrayBuffer): Map<string, ArrayBuffer> {
  const view = new DataView(buffer)
  let offset = 0

  // Magic
  const magic = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  )
  if (magic !== MAGIC) {
    throw new Error(`Invalid VGSP magic: expected "${MAGIC}", got "${magic}"`)
  }
  offset += 4

  // Version
  const version = view.getUint32(offset, true)
  if (version !== VERSION) {
    throw new Error(
      `Unsupported VGSP version: ${version} (expected ${VERSION})`
    )
  }
  offset += 4

  // Num files
  const numFiles = view.getUint32(offset, true)
  offset += 4

  // Parse entry table
  const entries: VGSPEntry[] = []
  const decoder = new TextDecoder()

  for (let i = 0; i < numFiles; i++) {
    const cellIdLength = view.getUint16(offset, true)
    offset += 2

    const cellIdBytes = new Uint8Array(buffer, offset, cellIdLength)
    const cellId = decoder.decode(cellIdBytes)
    offset += cellIdLength

    const slice = view.getUint8(offset)
    offset += 1

    const dataOffset = view.getUint32(offset, true)
    offset += 4

    const dataLength = view.getUint32(offset, true)
    offset += 4

    entries.push({ cellId, slice, offset: dataOffset, length: dataLength })
  }

  // Extract each slice buffer and store in cache
  const cache = new Map<string, ArrayBuffer>()

  for (const entry of entries) {
    const key = `${entry.cellId}:${entry.slice}`
    // Slice the ArrayBuffer — zero-copy view into the original buffer
    const sliceBuffer = buffer.slice(entry.offset, entry.offset + entry.length)
    cache.set(key, sliceBuffer)
  }

  return cache
}
