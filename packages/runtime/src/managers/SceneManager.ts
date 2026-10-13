import * as THREE from "three"
import {
  Catalyst,
  BezierCurve,
  FirstPersonController,
  Node3D,
  PointOfInterest,
  FocalPointTrigger,
  GuidedCamera,
  FocalPoint,
  isNode3D,
  Collider,
  VolumetricGaussianSplat,
  parseJsonNodes,
} from "@vitrine/catalyst"
import type { InputForceData } from "@vitrine/catalyst/helm/mapping/InputMapper"
import { probeGPUCapacity } from "@vitrine/stelligra"
import Spektra from "@vitrine/spektra"

import { CameraPathRecorder } from "../camera/CameraPathRecorder"
import { CameraPathPlayer } from "../camera/CameraPathPlayer"
import { Modal } from "./Modal"
import BaseManager from "./BaseManager"
import type { JsonAsset } from "@vitrine/assets"
import type { BakedCameraPath } from "../camera/CameraPathRecorder"
import {
  isWithinAnyRange,
  resolveProgressPoint,
  type GuidedCameraSettings,
  type LoadedManifest,
  type ProgressPoint,
} from "../manifest"
import {
  defaultTargetFps,
  mouseInteractThreshold,
  scrollMessageDisplayLimit,
} from "../constants"
import { debug } from "../utils"
import { mapRange } from "../utils/general/mapRange"
import { remapProgress } from "../utils/general/remapProgress"

const toVector3 = (v: [number, number, number]) => new THREE.Vector3(...v)
const toQuaternion = (q: [number, number, number, number]) =>
  new THREE.Quaternion(...q)

export default class SceneManager extends BaseManager {
  public fixedCamera?: GuidedCamera
  public controller?: FirstPersonController
  public lastFrameTime: number = 0
  public introSequenceActive: boolean = true

  private focalPoints!: Node3D
  private focalPointTriggers!: Node3D
  private pointsOfInterest: Node3D | null = null
  private environment: Node3D | null = null
  private rail: Node3D | null = null
  private disposed: boolean = false
  private cleanups: (() => void)[] = []
  private resolveReady!: () => void
  /** Resolves once the scene trees, cameras and controller exist (before assets finish). */
  public readonly ready: Promise<void> = new Promise((resolve) => {
    this.resolveReady = resolve
  })

  private vgs?: VolumetricGaussianSplat
  private vgsReady: boolean = false
  private vgsIdleFrames: number = 0

  private _path: BezierCurve | null = null
  private pathProgress: number = 0.0
  private pathMod: number = 1.0
  private scrollMessageDisplayCount = 0
  private footerReadEnd: number = 1.1

  private _progressDotsInit: boolean = false

  private _isRecording: boolean = false
  private _recorder: CameraPathRecorder | null = null
  private _player: CameraPathPlayer | null = null
  private _useBakedPath: boolean = false

  private static readonly ACTIONS = [
    "toggleCamera",
    "shutdown",
    "logPos",
    "close",
    "interact",
    "mouseInteract",
    "toggleDebug",
    "renderVgs",
    "clearVgs",
    "record",
    "toggleBaked",
    "toggleMute",
    "setRailProgress",
  ]

  private get manifest(): LoadedManifest {
    return this.managers.manifest
  }

  private get guided(): GuidedCameraSettings | undefined {
    return this.manifest.camera.guided
  }

  public setup: () => Promise<void> = async () => {
    debug("Initial three scene setup.")

    this.managers.game.initialise()

    this.focalPoints = await this.setupFocalPoints()
    if (this.disposed) return

    this.fixedCamera = new GuidedCamera({
      name: "guided-camera",
      visualise: false,
      focalLength: { current: this.guided?.focalLength ?? 14 },
      focalPoints: this.focalPoints.getChildrenOfType(
        FocalPoint
      ) as FocalPoint[],
    })

    this.pointsOfInterest = await this.setupPointsOfInterest()
    if (this.disposed) return
    this.rail = this.setupGuidedCameraRail()
    this.setupSignalSubscriptions()
    this.controller = this.setupFirstPersonController()

    this.environment = await this.setupEnvironmentCollisions()
    if (this.disposed) return
    this.focalPointTriggers = await this.setupFocalPointTriggers(
      this.focalPoints.getChildrenOfType(FocalPoint) as FocalPoint[]
    )
    if (this.disposed) return

    this.setupKeybinds()

    this.cleanups.push(
      Catalyst._.signals.onRender.subscribe(() => {
        this.computeVgs()
      })
    )

    const catalyst = Catalyst._
    catalyst.targetFPS = this.manifest.rendering?.targetFps ?? defaultTargetFps
    catalyst.initialise().then(() => {
      if (this.disposed) return
      if (!catalyst.getIsRunning()) catalyst.start()

      if (Catalyst._.camera && this?.controller?.camera)
        Catalyst._.camera.target = this.controller.camera

      if (this.manifest.camera.initial === "guided") this.toggleCamera()
      this.fixedCamera?.snapToTarget()
      this.footerReadEnd = this.managers.ui.calculateFooterEnd()
      this.resolveReady()
    })
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.vgsReady = false
    this.resolveReady()

    if (this._isRecording) {
      this._isRecording = false
      this._recorder = null
    }

    this.cleanups.forEach((cleanup) => cleanup())
    this.cleanups = []

    this.controller?.disablePointerLock()

    ;[
      this.vgs,
      this.controller,
      this.fixedCamera,
      this.rail,
      this.pointsOfInterest,
      this.focalPointTriggers,
      this.focalPoints,
      this.environment,
    ].forEach((node) => node?.dispose())

    this.vgs = undefined
    this.controller = undefined
    this.fixedCamera = undefined
    this.rail = null
    this.pointsOfInterest = null
    this.environment = null
    this._path = null
    this._player = null
  }

  /** The node trees parsed from the manifest's scene files, for tooling. */
  public get sceneRoots(): Record<string, Node3D | null> {
    return {
      colliders: this.environment,
      focalPoints: this.focalPoints ?? null,
      focalPointTriggers: this.focalPointTriggers ?? null,
      pointsOfInterest: this.pointsOfInterest,
    }
  }

  /** The guided rail, for tooling. */
  public get railPath(): BezierCurve | null {
    return this._path
  }

  /** Whether the guided camera follows the baked recording (true) or the live rail (false). */
  public get useBakedPath(): boolean {
    return this._useBakedPath
  }

  public set useBakedPath(enabled: boolean) {
    this._useBakedPath = enabled && this._player !== null
    if (this.fixedCamera) this.fixedCamera.paused = this._useBakedPath
  }

  public get isRecording(): boolean {
    return this._isRecording
  }

  public get pathProgressValue(): number {
    return this.pathProgress
  }

  /** Turn the debug visualisers on or off for every node in the scene trees. */
  public visualiseScene(enabled: boolean): void {
    Object.values(this.sceneRoots).forEach((root) => {
      root?.walk().forEach((node) => {
        if (node instanceof Node3D && node !== root) node.visualised = enabled
      })
    })
    if (this.vgs) this.vgs.visualised = enabled
  }

  public get volumetricSplat(): VolumetricGaussianSplat | undefined {
    return this.vgs
  }

  public get isVgsReady(): boolean {
    return this.vgsReady
  }

  private computeVgs(): void {
    if (!this.vgsReady) return
    const camera = Catalyst._.camera
    const renderer = Catalyst._.renderer
    if (!camera || !renderer) return

    if (this.vgs) {
      // Desired state only changes when the camera moves; refresh occasionally
      // while still so newly loaded slices get picked up
      if (camera.isDirty || ++this.vgsIdleFrames >= 10) {
        this.vgsIdleFrames = 0
        const ideal = this.vgs.computeDesiredState()
        this.vgs.reconcile(ideal)
      }
      this.vgs.updateRenderer(camera.view, renderer)
    }
  }

  private clearVgs(): void {
    if (this.vgs) this.vgs.hideAll()
  }

  private async loadSceneNodes(asset: JsonAsset | undefined, name: string) {
    if (!asset) return new Node3D(name)
    await asset.ensure()
    return parseJsonNodes(asset.json) as Node3D
  }

  private async setupPointsOfInterest(): Promise<Node3D> {
    const parsed = await this.loadSceneNodes(
      this.managers.exhibitionAssets.scene.pointsOfInterest,
      "pointsOfInterest"
    )
    const pois = parsed.getChildrenOfType(PointOfInterest) as PointOfInterest[]
    const content = this.managers.content.byId

    pois.forEach((poi: PointOfInterest) => {
      const modalName = poi.modalName
      if (!modalName) return
      const template = content[modalName]
      if (!template) {
        debug(`No content "${modalName}" for ${poi.name}`, "warning")
        return
      }
      poi.onInteract = () => {
        Modal._.openWithTemplate(template)
      }
    })

    return parsed
  }

  private async setupFocalPointTriggers(
    focalPoints: FocalPoint[]
  ): Promise<Node3D> {
    const parsed = await this.loadSceneNodes(
      this.managers.exhibitionAssets.scene.focalPointTriggers,
      "focalPointTriggers"
    )

    const triggers = parsed.getChildrenOfType(
      FocalPointTrigger
    ) as FocalPointTrigger[]

    triggers.forEach((trigger: FocalPointTrigger) => {
      trigger.focalPoints = focalPoints
    })

    return parsed
  }

  public restart(): void {
    this.pathProgress = 0
    this.handleForceUpdate({ force: new THREE.Vector3(0, 0, 0) })
  }

  public jumpToPathProgress(progress: number): void {
    this.pathProgress = progress
    this.handleForceUpdate({ force: new THREE.Vector3(0, 0, 0) })
  }

  private setupFirstPersonController(): FirstPersonController {
    const controller = new FirstPersonController({
      visualise: false,
      canLockPointer: (event) =>
        !this.managers.state.isPaused &&
        !Modal._.isOpen &&
        (this.managers.state.lockPointerFilter?.(event.target) ?? true),
    })

    const start = this.manifest.camera.firstPerson?.start
    if (start) controller.transform.position = toVector3(start)
    controller.rigidBody.sync()

    this.cleanups.push(
      Catalyst._.signals.onUpdate.subscribe(() => {
      if (!this.managers?.state) return

      const result = this.controller?.raycast.cast()

      this.managers.state.currentRayIntersection = result?.[0]
        ? result[0][0].collider
        : null

      if (!controller.debugMode) return
      if (!this.managers.state.moveNode) return

      const node = this.managers.state.moveNode

      if (!isNode3D(node)) return

      const controllerPos = controller.camera.transform.getWorldPosition()
      const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(
        controller.camera.transform.getWorldRotation()
      )

      const offset = 2.0
      node.transform.position = controllerPos
        .clone()
        .addScaledVector(cameraForward, offset)

      const lookBackDir = controllerPos.clone().sub(node.transform.position)
      lookBackDir.y = 0
      lookBackDir.normalize()

      const lookBackRotation = new THREE.Quaternion()
      lookBackRotation.setFromUnitVectors(
        new THREE.Vector3(0, 0, -1),
        lookBackDir
      )
      node.transform.rotation = lookBackRotation
      })
    )

    return controller
  }

  private setupGuidedCameraRail(): Node3D {
    const rail = new Node3D("rail")
    const path = new BezierCurve({ name: "path" })
    rail.addNode(path)

    const guided = this.guided
    guided?.rail.controlPoints.forEach((cp) => {
      path.addControlPoint({ point: toVector3(cp.point), name: cp.name })
    })

    this._path = path

    if (guided?.rail.offset) {
      rail.transform.position = toVector3(guided.rail.offset)
    }

    this.cleanups.push(
      Catalyst._.signals.onUpdate.subscribe(() => {
        if (!this._isRecording || !this._recorder || !this.fixedCamera) return

        Catalyst._.signals.input.onForceChanged.emit({
          force: new THREE.Vector3(0, 2, 0),
        })

        this._recorder.captureFrame(this.pathProgress, this.fixedCamera)

        if (this.pathProgress >= 1.0) {
          this.stopRecording()
        }
      })
    )

    this.cleanups.push(
      Catalyst._.signals.input.onForceChanged.subscribe(
        (data: InputForceData) => {
          this.handleForceUpdate(data)
        }
      )
    )

    this.pathProgress = 0
    const startPoint = path.getPointAt(this.pathProgress)
    if (this.fixedCamera && startPoint)
      this.fixedCamera.transform.position = startPoint

    return rail
  }

  private resolvePoint(point: ProgressPoint | undefined): number | null {
    if (point === undefined || !this._path) return null
    return resolveProgressPoint(this._path, point)
  }

  private isBelow(point: ProgressPoint | undefined): boolean {
    const resolved = this.resolvePoint(point)
    return resolved !== null && this.pathProgress < resolved
  }

  private isAbove(point: ProgressPoint | undefined): boolean {
    const resolved = this.resolvePoint(point)
    return resolved !== null && this.pathProgress > resolved
  }

  private currentScrollSpeed(): number {
    const guided = this.guided
    if (!guided || !this._path) return 1
    const segment = guided.scroll.speedSegments?.find((s) =>
      this._path!.isBetweenControlPoints(
        this.pathProgress,
        s.segment[0],
        s.segment[1]
      )
    )
    return segment?.speed ?? guided.scroll.speed
  }

  public handleForceUpdate(data: InputForceData): void {
    if (!this.vgsReady) return
    if (!this.managers.state.isGuidedCamera) return
    if (!this.fixedCamera) return
    if (!this._path) return

    const guided = this.guided
    if (!guided) return
    const presentation = this.manifest.presentation ?? {}

    const railForce = data.force.y
    this.pathProgress += guided.scroll.increment * (railForce * this.pathMod)

    if (this.pathProgress > this.footerReadEnd)
      this.pathProgress = this.footerReadEnd
    if (this.pathProgress < 0.0) this.pathProgress = 0.0

    if (this._useBakedPath && this._player) {
      this._player.apply(this.pathProgress, this.fixedCamera)
    } else {
      const point = this._path.getPointAt(this.pathProgress)
      if (point) this.fixedCamera.transform.position = point
    }

    if (data.force.y > 0) {
      if (this.scrollMessageDisplayCount < scrollMessageDisplayLimit) {
        this.managers.game.clearInputTimeout()
      }

      this.managers.ui.hideMessage()
    }

    this.pathMod = this.currentScrollSpeed()

    // Landing card: slides away over the first part of its rail segment
    const landing = presentation.landing
    const landingSegment = landing?.segment
    const subProgress = landingSegment
      ? this._path.getMappedParameterBetween(
          this.pathProgress,
          landingSegment[0],
          landingSegment[1]
        )
      : null
    const landingOffset = landing?.offsetVh ?? 150

    if (this.isBelow(presentation.header?.hideBelow))
      this.managers.ui.hideHeader()
    if (this.isAbove(presentation.header?.showAbove))
      this.managers.ui.showHeader()

    this.managers.ui.updateLandingCardOffset(
      subProgress !== null
        ? mapRange(subProgress, 0, landing?.scrollOutAt ?? 1, 0, landingOffset)
        : landingOffset
    )

    // Footer card: slides up over its reveal range
    const footer = presentation.footer
    const revealFrom = this.resolvePoint(footer?.reveal?.from)
    const revealTo = this.resolvePoint(footer?.reveal?.to) ?? 1.0
    if (revealFrom !== null) {
      this.managers.ui.updateFooterCardOffset(
        this.pathProgress >= revealFrom && this.pathProgress <= revealTo
          ? mapRange(this.pathProgress, revealFrom, revealTo, 200, 0, true)
          : this.pathProgress >= revealFrom
          ? 0
          : 200
      )
    }

    const remappedProgress =
      (guided.progressRemap
        ? remapProgress(this.pathProgress, guided.progressRemap)
        : this.pathProgress) * 100

    this.managers.ui.updateFooterCopyOffset(this.pathProgress)
    this.managers.ui.updateProgress(remappedProgress)

    const revealAt = guided.progressMarkersRevealAt ?? 0
    if (!this._progressDotsInit && remappedProgress > revealAt) {
      this._progressDotsInit = true
      const stagger = 100

      guided.progressMarkers?.forEach((marker, index) => {
        setTimeout(() => {
          this.managers.ui.addProgressPoi({
            percentage: marker.percentage,
            id: index + 1,
            onClick: () => this.jumpToPathProgress(marker.progress),
          })
        }, stagger * index)
      })
    }

    const blur = footer?.blur
    const blurFrom = this.resolvePoint(blur?.range.from)
    const blurTo = this.resolvePoint(blur?.range.to) ?? 1.0
    if (blur && blurFrom !== null) {
      const footerBlur = mapRange(
        this.pathProgress,
        blurFrom,
        blurTo,
        0,
        blur.px
      )
      document.body.style.setProperty("--fc-blur", `${footerBlur}px`)
    }

    this.introSequenceActive = subProgress ? true : false

    this.applyActivationRules(guided)
  }

  private applyActivationRules(guided: GuidedCameraSettings): void {
    if (!this._path) return
    const path = this._path

    guided.activation?.forEach((rule) => {
      const active = isWithinAnyRange(path, this.pathProgress, rule.activeWhen)

      if (rule.focalPoint) {
        const node = this.focalPoints.getNode<FocalPoint>(rule.focalPoint)
        if (node) node.active = active
      }

      if (rule.triggerTag) {
        const nodes = this.focalPointTriggers.getNodesByTag(
          rule.triggerTag
        ) as FocalPoint[]
        nodes?.forEach((node) => {
          node.active = active
        })
      }
    })
  }

  private async setupFocalPoints(): Promise<Node3D> {
    return this.loadSceneNodes(
      this.managers.exhibitionAssets.scene.focalPoints,
      "focalPoints"
    )
  }

  private async setupEnvironmentCollisions(): Promise<Node3D> {
    return this.loadSceneNodes(
      this.managers.exhibitionAssets.scene.colliders,
      "environmentColliders"
    )
  }

  public setupKeybinds(): void {
    const input = Catalyst._.input
    if (!input) return

    input.bind("toggleCamera", "p")
    input.bind("shutdown", "shift+q", { taps: 3 })
    input.bind("logPos", "l")
    input.bind("close", "Escape")
    input.bind("interact", "f")
    input.bind("mouseInteract", "mouse:left")
    input.bind("toggleDebug", "o")
    input.bind("renderVgs", "u")
    input.bind("clearVgs", "i")
    input.bind("record", "r")
    input.bind("toggleBaked", "b")
    input.bind("toggleMute", "m")

    input.bind("setRailProgress", "numbers")

    this.cleanups.push(() => {
      SceneManager.ACTIONS.forEach((action) => input.unbind(action))
    })

    const unsubscribe = input.signals.onActionEnd.subscribe(({ action, context }) => {
      if (action === "logPos" && this.controller) {
        console.log("current pos: ", this.controller.transform.position)
      }

      if (action === "setRailProgress") {
        if (context?.triggerKey) {
          this.pathProgress = parseFloat(`0.${context?.triggerKey}`)
        }
      }

      if (action === "renderVgs") {
        if (!__DEBUG__) return
        Catalyst._.renderer?.setPixelRatio(window.devicePixelRatio)
        this.computeVgs()
      }

      if (action === "clearVgs") {
        if (!__DEBUG__) return
        this.clearVgs()
      }

      if (action === "record") {
        if (!__DEBUG__) return
        this._isRecording ? this.stopRecording() : this.startRecording()
      }

      if (action === "toggleBaked") {
        if (!__DEBUG__) return
        this._useBakedPath = !this._useBakedPath
        if (this.fixedCamera) this.fixedCamera.paused = this._useBakedPath
        console.log(`Baked path: ${this._useBakedPath ? "ON" : "OFF"}`)
      }

      if (action === "toggleDebug") {
        if (!__DEBUG__) return
        this.controller?.toggleDebugMode()

        this.managers.ui.setInteractionLabel(
          this?.controller?.debugMode ? "move" : "View"
        )

        if (!this.controller?.debugMode) {
          const node = this.managers.state?.moveNode
          const pos = node?.transform.position
          const rot = node?.transform.rotation

          if (pos) {
            console.log(`"position": [${pos.x}, ${pos.y}, ${pos.z}]`)
          }

          if (rot) {
            console.log(`"rotation": [${rot.x}, ${rot.y}, ${rot.z}, ${rot.w}]`)
          }

          if (node instanceof Collider) node.needsUpdate()

          this.managers.state.stopNodeMove()
        }
      }

      if (action === "toggleMute") {
        this.managers.state.toggleMute()
      }

      if (action === "toggleCamera") {
        if (!this.vgsReady) return
        this.toggleCamera()
      }

      if (action === "interact") {
        if (this.managers.state.currentRayIntersection) {
          if (this?.controller?.debugMode) {
            this.managers.state.startNodeMove()
            return
          }

          this.managers.state.currentRayIntersection.parentNode?.parent?.signals?.onInteract?.emit(
            undefined
          )
        }
      }

      if (action === "mouseInteract") {
        if (this.managers.state.isGuidedCamera) return
        if (!this.controller?.isPointerLocked) return
        if (Date.now() - Modal._.modalCloseTime < mouseInteractThreshold)
          return
        if (Modal._.isOpen) return

        if (this.managers.state.currentRayIntersection) {
          if (this?.controller?.debugMode) {
            this.managers.state.startNodeMove()
            return
          }

          this.managers.state.currentRayIntersection.parentNode?.parent?.signals?.onInteract?.emit(
            undefined
          )
        }
      }

      if (action === "shutdown") {
        if (!__DEBUG__) return
        debug("Shutting down Catalyst Engine...", "Catalyst")
        Catalyst._?.shutdown()
      }

      if (action === "close") {
        if (Spektra.isOpen) {
          Spektra.close()
          this.managers.ui.playUISound("clack")
        } else if (Modal._.isOpen) {
          Modal._.close()
          this.managers.ui.playUISound("clack")
        } else {
          Modal._.openWithTemplate(this.managers.content.pause)
          this.managers.ui.playUISound("click")
        }
      }
    })
    this.cleanups.push(unsubscribe)
  }

  private setupSignalSubscriptions(): void {
    this.cleanups.push(
      Catalyst._.signals.game.onInputTimeout.subscribe(() => {
        if (!this.managers.state?.isGuidedCamera) return
        const after = this.manifest.presentation?.hud?.moveHintAfter
        if (after !== undefined && !this.isAbove(after)) return

        this.scrollMessageDisplayCount++
        this.managers.ui.showMessage()
      })
    )
  }

  public toggleCamera(): void {
    if (!this.fixedCamera || !this.controller?.camera || !Catalyst._) return

    const camera = Catalyst._.camera
    if (!camera) return

    if (camera.target === this.controller.camera.view) {
      Catalyst._.signals.game.onGuidedActivated.emit()
      camera.target = this.fixedCamera.view
      this.managers.ui.hideHeader()
      this.controller.active = false
    } else {
      Catalyst._.signals.game.onFPCameraActivated.emit()
      camera.target = this.controller.camera
      this.managers.ui.showHeader()
      this.controller.active = true
    }
  }

  public startRecording(): void {
    if (!this.fixedCamera) return

    this._isRecording = true
    this.fixedCamera.paused = false
    this._recorder = new CameraPathRecorder()
    this.pathProgress = 0
    this.fixedCamera.snapToTarget()
    this._useBakedPath = false

    console.log("[recording] Started")
  }

  public stopRecording(): void {
    if (!this._isRecording || !this._recorder) return
    this._isRecording = false
    if (this.fixedCamera) this.fixedCamera.paused = true

    const baked = this._recorder.export()
    console.log(`Recorded ${baked.frameCount} frames`)

    const json = JSON.stringify(baked)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "camera-path.json"
    a.click()
    URL.revokeObjectURL(url)

    Catalyst._.input?.resume()
    this._recorder = null
  }

  private async loadBakedPath(): Promise<void> {
    const asset = this.managers.exhibitionAssets.bakedPath as
      | JsonAsset<BakedCameraPath>
      | undefined
    if (!asset) return
    await asset.ensure()
    if (this.disposed) return
    this._player = new CameraPathPlayer()
    this._player.load(asset.json)
    this._useBakedPath = true
    if (this.fixedCamera) this.fixedCamera.paused = true
  }

  public async loadAssets(): Promise<void> {
    const manifest = this.manifest
    const exhibition = this.managers.exhibitionAssets

    await exhibition.core.ensure({
      onProgress: (progress) => {
        this.managers.ui.updateLoadingProgress(progress.percentage)
      },
    })
    if (this.disposed) return

    this.managers.ui.completeLoading()

    exhibition.audio.forEach(({ asset, group, decode }, name) => {
      this.managers.audio.loadTrack(name, asset, { group, decode })
    })

    const renderer = Catalyst._.renderer
    if (!renderer || !Catalyst._.scene) return

    const gpuCapacity = await probeGPUCapacity(renderer)
    if (this.disposed) return
    const transform = manifest.splat.transform

    const vgs = new VolumetricGaussianSplat({
      name: manifest.id,
      url: manifest.splat.source,
      gpuCapacity: gpuCapacity,
      position: transform?.position && toVector3(transform.position),
      rotation: transform?.rotation && toQuaternion(transform.rotation),
      scale: transform?.scale,
      ...manifest.splat.streaming,
    })
    this.vgs = vgs

    // Partitions go in one after another, in manifest order, the way
    // Beruk chained s0..s4; the scene is ready once the last is in
    const loadNext = (index: number) => {
      if (this.disposed) return
      const partition = exhibition.partitions[index]
      if (!partition) {
        this.vgsReady = true
        return
      }
      vgs.loadPartition(partition.buffer, () => {
        partition.release()
        loadNext(index + 1)
      })
    }
    loadNext(0)

    await this.loadBakedPath()
  }
}
