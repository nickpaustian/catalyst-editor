/**
 * Minimal ZIP reader for browser ArrayBuffer input.
 *
 * Supports only STORE (compression method 0) entries, which is the method
 * used by the SOG bundled format (.sog files). Compressed ZIP entries will
 * throw rather than silently produce garbage output.
 *
 * Returns a Map of filename → raw bytes for every entry in the archive.
 */
export function unzipStoredEntries(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const u8 = new Uint8Array(buffer)
  const dv = new DataView(buffer)
  const entries = new Map<string, Uint8Array>()

  const SIG_LOCAL = 0x04034b50
  const SIG_CENTRAL = 0x02014b50
  const SIG_EOCD = 0x06054b50
  const SIG_DD = 0x08074b50

  let cursor = 0
  const size = u8.length

  while (cursor + 30 <= size) {
    const sig = dv.getUint32(cursor, true)
    if (sig === SIG_CENTRAL || sig === SIG_EOCD) break
    if (sig !== SIG_LOCAL) break

    const gpFlags = dv.getUint16(cursor + 6, true)
    const method = dv.getUint16(cursor + 8, true)
    const nameLen = dv.getUint16(cursor + 26, true)
    const extraLen = dv.getUint16(cursor + 28, true)

    if (method !== 0) {
      throw new Error(`Unsupported ZIP compression method: ${method} (SOG bundles use STORE=0 only)`)
    }

    const nameBytes = u8.subarray(cursor + 30, cursor + 30 + nameLen)
    const utf8 = (gpFlags & 0x800) !== 0
    const name = new TextDecoder(utf8 ? "utf-8" : "ascii").decode(nameBytes)

    const headerEnd = cursor + 30 + nameLen + extraLen
    const useDescriptor = (gpFlags & 0x8) !== 0

    if (!useDescriptor) {
      const sizeUncomp = dv.getUint32(cursor + 22, true)
      entries.set(name, u8.slice(headerEnd, headerEnd + sizeUncomp))
      cursor = headerEnd + sizeUncomp
    } else {
      // Data descriptor follows the file data — scan for the signature
      let pos = headerEnd
      let found = false
      while (pos + 16 <= size) {
        if (dv.getUint32(pos, true) === SIG_DD) {
          const sizeUncomp = dv.getUint32(pos + 8, true)
          entries.set(name, u8.slice(headerEnd, headerEnd + sizeUncomp))
          cursor = pos + 16
          found = true
          break
        }
        pos++
      }
      if (!found) throw new Error(`ZIP data descriptor not found for entry: ${name}`)
    }
  }

  return entries
}
