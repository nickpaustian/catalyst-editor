import {
  Catalyst,
  isNode3D,
  Node3D,
  PointOfInterest,
} from "@vitrine/catalyst"
import type { Collider } from "@vitrine/catalyst/velora/colliders/Collider"
import BaseManager from "./BaseManager"

export default class StateManager extends BaseManager {
  public isPaused: boolean = false
  public isGuidedCamera: boolean = false
  private _currentRayIntersection: Collider | null = null
  private _movingNode: Node3D | null = null
  public isMuted: boolean = false

  public set currentRayIntersection(collider: Collider | null) {
    if (collider !== this._currentRayIntersection) {
      // Clear state on current collider
      const poiNode = this._currentRayIntersection?.parentNode?.parent

      if (poiNode && poiNode instanceof PointOfInterest) {
        poiNode.isFocused = false
      }

      Catalyst._.signals.game.onRayTargetChanged.emit({ collider })
      this._currentRayIntersection = collider
    }
  }

  public get currentRayIntersection(): Collider | null {
    return this._currentRayIntersection
  }

  public startNodeMove(): void {
    if (
      !this._currentRayIntersection?.parentNode ||
      !isNode3D(this._currentRayIntersection?.parentNode)
    )
      return
    this._movingNode = this._currentRayIntersection?.parentNode
  }

  public stopNodeMove(): void {
    this._movingNode = null
  }

  public get moveNode(): Node3D | null {
    return this._movingNode
  }

  public toggleMute(): void {
    this.managers.audio.toggleMute()
    Catalyst._.signals.game.onAudioMuteChange.emit({
      muted: this.managers.audio.isMuted,
    })
  }
}
