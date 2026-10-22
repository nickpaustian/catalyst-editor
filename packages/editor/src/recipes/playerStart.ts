import { Node3D, svgIcon, type Node3DOptions } from "@nickpaustian/catalyst"
import { DebugShapes } from "@nickpaustian/catalyst"
import type { Object3D } from "three"

/** Where a run puts the player: position and facing. One per scene is read; more are ignored. */
export class PlayerStart extends Node3D {
  static icon = svgIcon('<circle cx="8" cy="4" r="2.2"/><path d="M4 14.5v-3a4 4 0 0 1 8 0v3"/><path d="M8 1v1.5"/>')

  constructor(options: Node3DOptions | string = {}) {
    const opts = typeof options === "string" ? { name: options } : options
    super({ ...opts, name: opts.name ?? "playerStart" })
  }

  protected override createVisualisation(): Object3D {
    return DebugShapes.capsule({ radius: 0.15, height: 1.7, colour: 0x6ad0ff })
  }
}
