import { Catalyst, nextTick, PointOfInterest, Signal } from "@vitrine/catalyst"
import { Modal } from "./Modal"
import * as THREE from "three"
import type { Collider } from "@vitrine/catalyst/velora/colliders/Collider"
import BaseManager from "./BaseManager"
import { defaultRenderResolution, uiTimeoutTime } from "../constants"

export default class GameManager extends BaseManager {
  private inputTimeout: number = 0

  public initialise(): void {
    this.initialiseCatalyst()
    this.registerSignals()
    this.registerListeners()
  }

  public initialiseCatalyst(): void {
    Catalyst.getInstance({
      container: "#app",
    })
    Catalyst._.resolution =
      this.managers.manifest.rendering?.resolution ?? defaultRenderResolution

    Catalyst._.physics?.setConfig({
      gravity: 9.8,
      drag: 0.1,
      groundPlaneHeight: 0,
      defaultScene: Catalyst._.scene,
    })

    Catalyst._.scene.environmentRotation.y = 1.0
    Catalyst._.scene.background = new THREE.Color(0x000000)
    Catalyst._.renderer?.domElement.setAttribute("aria-hidden", "true")
  }

  public registerSignals(): void {
    Catalyst._.signals.registerGroup("game", {
      onPause: new Signal<void>(),
      onResume: new Signal<void>(),
      onRayTargetChanged: new Signal<{ collider: Collider }>(),
      onFPCameraActivated: new Signal<void>(),
      onGuidedActivated: new Signal<void>(),
      onModalOpen: new Signal<void>(),
      onModalClose: new Signal<void>(),
      onPointerLockChange: new Signal<{ enabled: boolean }>(),
      onInputTimeout: new Signal<void>(),
      onAudioMuteChange: new Signal<{ muted: boolean }>(),
    })
  }

  public registerListeners() {
    Catalyst._.signals.game.onPause.subscribe(() => {
      Modal._.openWithTemplate(this.managers.content.pause)
    })

    Catalyst._.signals.game.onResume.subscribe(() => {
      Modal._.close()
    })

    Catalyst._.signals.game.onRayTargetChanged.subscribe(
      (data: { collider: Collider | null }) => {
        if (!this.managers) return

        const poiNode = data.collider?.parentNode?.parent

        if (poiNode && poiNode instanceof PointOfInterest) {
          poiNode.isFocused = true
        }

        data.collider
          ? this.managers.ui.activateCrosshair()
          : this.managers.ui.deactivateCrosshair()

        data.collider
          ? this.managers.scene?.controller?.squint()
          : this.managers.scene?.controller?.unsquint()
      }
    )

    Catalyst._.signals.game.onFPCameraActivated.subscribe(() => {
      this.managers.ui.disableGuidedMode()
      if (!this.managers.state.isPaused)
        this.managers.scene.controller?.enablePointerLock()
      this.managers.state.isGuidedCamera = false
    })

    Catalyst._.signals.game.onGuidedActivated.subscribe(() => {
      this.managers.ui.enableGuidedMode()
      this.managers.scene.controller?.disablePointerLock()
      this.managers.state.isGuidedCamera = true
    })

    Catalyst._.signals.game.onPointerLockChange.subscribe(
      (data: { enabled: boolean }) => {
        if (!data?.enabled) {
          nextTick(() => {
            if (this.managers.state.isGuidedCamera) return
            if (Modal._.isOpen) return
            Catalyst._.signals.game.onPause.emit()
          })
        }
      }
    )

    Catalyst._.signals.game.onModalOpen.subscribe(() => {
      if (!this.managers.state.isGuidedCamera)
        this.managers.scene.controller?.disablePointerLock()
    })

    Catalyst._.signals.game.onModalClose.subscribe(() => {
      if (!this.managers.state.isGuidedCamera)
        this.managers.scene.controller?.enablePointerLock()
    })
  }

  public clearInputTimeout(): void {
    clearTimeout(this.inputTimeout)

    this.inputTimeout = setTimeout(() => {
      Catalyst._.signals.game.onInputTimeout.emit()
    }, uiTimeoutTime)
  }
}
