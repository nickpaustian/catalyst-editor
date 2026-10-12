/**
 *
 * Standalone worker module
 */

import init, { decode_sog, free_buffer, wasmUrl } from "@vitrine/stelligra/wasm"
import { packSplats } from "@vitrine/stelligra/packing"

self.addEventListener("unhandledrejection", (e) => {
  console.error("Worker unhandled rejection:", e.reason)
})

let _wasmInitialised = false

async function ensureInit(): Promise<void> {
  if (_wasmInitialised) return
  await init(wasmUrl)
  _wasmInitialised = true
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === "warmup") {
    await ensureInit()
    return
  }

  if (msg.type !== "process") return

  try {
    await ensureInit()

    const resultBytes = decode_sog(
      new Uint8Array(msg.buffer),
      msg.worldMatrix,
      msg.shBands,
    )

    const dv = new DataView(resultBytes.buffer)
    const count = dv.getUint32(0, true)
    const centerOffset = dv.getUint32(4, true)
    const colorOffset = dv.getUint32(8, true)
    const covOffset = dv.getUint32(12, true)
    const boundsOffset = dv.getUint32(16, true)
    const shOffset = dv.getUint32(20, true)
    const shStride = dv.getUint32(24, true)

    const buffer = resultBytes.buffer
    const packed = packSplats(
      count,
      new Float32Array(buffer, centerOffset, count * 4),
      new Uint32Array(buffer, colorOffset, count),
      new Float32Array(buffer, covOffset, count * 8),
    )
    // Copy before free — views into WASM memory are invalidated afterwards
    const positions = new Float32Array(buffer, centerOffset, count * 4).slice()
    const boundsMin = new Float32Array(buffer, boundsOffset, 3).slice()
    const boundsMax = new Float32Array(buffer, boundsOffset + 12, 3).slice()
    const sh = new Uint32Array(buffer, shOffset, count * shStride).slice()

    free_buffer(resultBytes)

    self.postMessage(
      {
        type: "processed",
        id: msg.id,
        count,
        packed,
        positions,
        sh,
        boundsMin,
        boundsMax,
      },
      {
        transfer: [
          packed.buffer,
          positions.buffer,
          sh.buffer,
          boundsMin.buffer,
          boundsMax.buffer,
        ],
      },
    )
  } catch (err: unknown) {
    self.postMessage({
      type: "error",
      id: msg.id,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
