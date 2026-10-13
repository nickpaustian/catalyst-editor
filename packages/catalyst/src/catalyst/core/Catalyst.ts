// Core
import * as THREE from "three"
import { VeloraEnvironment } from "@vitrine/catalyst/velora/VeloraEnvironment"
import { CatalystCamera } from "./CatalystCamera"
import { reQuester } from "@vitrine/catalyst/requester"

// Classes
import { GameLoop } from "./GameLoop"
import { SignalManager, type CatalystSignals } from "../signals"

// Utils
import { debug } from "@vitrine/debug"

import {
  createCanvas,
  createRenderer,
  createScene,
  resolveContainer,
  updateOnResize,
} from "../utils/initialisation"
import { Helm } from "@vitrine/catalyst/helm/core/Helm"
import { Slate } from "@vitrine/catalyst/slate"
import { buildNodeRegistry } from "../utils/buildNodeRegistry"
import {
  ResolutionController,
  type ResolutionSettings,
} from "./ResolutionController"

interface CatalystOptions {
  container?: HTMLElement | string
  features?: {
    renderer?: boolean // Three.js WebGL renderer
    physics?: boolean // Velora physics engine
    input?: boolean // Helm input manager
    ui?: boolean // Slate UI system
  }
  resolution?: ResolutionSettings
}

const DEFAULT_FEATURES = {
  renderer: true,
  physics: true,
  input: true,
  ui: true,
}

/**
 * Catalyst - The core engine that coordinates all systems.
 */
export class Catalyst {
  private static instance: Catalyst

  private gameLoop: GameLoop
  private isRunning: boolean = false
  private _shouldUpdate: boolean = true
  private _renderOnDemand: boolean = false
  private _renderRequested: boolean = true

  // Core objects
  private canvas!: HTMLCanvasElement
  private _renderer!: THREE.WebGLRenderer
  private _scene!: THREE.Scene
  private _camera!: CatalystCamera
  private _physics!: VeloraEnvironment
  private _input!: Helm
  private _ui!: Slate
  private _reQuester: reQuester
  private _nodeRegistry: Record<string, any>
  private _unit: number = 1

  // Frame rate
  private _targetFPS: number | null = null
  private _frameInterval: number = 0
  private _lastFrameTime: number = 0
  private _frameCount: number = 0
  private _resolution = new ResolutionController()

  private containerElement!: HTMLElement
  private _width: number
  private _height: number
  private _resizeObserver: ResizeObserver | null = null

  // Metrics

  private _startTime?: number

  // Signal system for event broadcasting
  private _signals: SignalManager

  constructor(options: CatalystOptions = {}) {
    const features = { ...DEFAULT_FEATURES, ...options.features }

    // Renderer & canvas
    if (features.renderer) {
      this.containerElement = resolveContainer(options.container)
      this.canvas = createCanvas(this.containerElement)
    }
    this._width = this.containerWidth || window.innerWidth
    this._height = this.containerHeight || window.innerHeight
    if (features.renderer) {
      this._renderer = createRenderer(this.canvas, this._width, this._height)
      this._scene = createScene()
      this._camera = new CatalystCamera(this._width, this._height)
      if (options.resolution) this._resolution.settings = options.resolution
    }

    // Physics
    if (features.physics) {
      this._physics = VeloraEnvironment._
    }

    // Input
    if (features.input) {
      this._input = Helm._
    }

    // UI
    if (features.ui) {
      this._ui = Slate._
    }

    this._reQuester = new reQuester()
    this._nodeRegistry = buildNodeRegistry()
    this._signals = new SignalManager()

    if (features.input && this._input) {
      this._signals.registerGroup("input", this._input.signals)
    }

    this.gameLoop = new GameLoop()

    window.addEventListener("resize", this.handleWindowResize)
    if (this.containerElement && typeof ResizeObserver !== "undefined") {
      this._resizeObserver = new ResizeObserver(() => this.handleWindowResize())
      this._resizeObserver.observe(this.containerElement)
    }

    debug("Catalyst Engine created", "Catalyst")
  }

  /**
   * Handle window resize events.
   */
  private handleWindowResize = (): void => {
    if (!this._shouldUpdate) return
    const width = this.containerWidth
    const height = this.containerHeight
    if (!width || !height) return
    if (width === this._width && height === this._height) return
    this._width = width
    this._height = height

    // Only update renderer/camera if initialised
    if (this._renderer && this._camera) {
      updateOnResize(this._camera.view, this._renderer, this._width, this._height)
      this._renderRequested = true
    }

    this._signals.onResize.emit({ width: this._width, height: this._height })
  }

  // The canvas fills its container, which is the window unless the host
  // page puts the engine in a smaller element
  private get containerWidth(): number {
    return this.containerElement ? this.containerElement.clientWidth : window.innerWidth
  }

  private get containerHeight(): number {
    return this.containerElement ? this.containerElement.clientHeight : window.innerHeight
  }

  /** Current drawing area in CSS pixels. */
  public get width(): number {
    return this._width
  }

  public get height(): number {
    return this._height
  }

  //=========================
  // Setters & Getters
  //=========================

  /**
   * Get the singleton instance.
   */
  public static getInstance(options: CatalystOptions = {}): Catalyst {
    if (!Catalyst.instance) {
      Catalyst.instance = new Catalyst(options)
    } else {
      if (options.features) {
        debug("Catalyst already initialised — feature flags ignored", "warning")
      }
      // Anything touching Catalyst._ before the host names a container gets
      // the engine in <body>; the named container takes over from there
      if (options.container) Catalyst.instance.setContainer(options.container)
    }
    return Catalyst.instance
  }

  /** Move the canvas into another element and size to it. */
  public setContainer(container: HTMLElement | string): void {
    const element = resolveContainer(container)
    if (!this.canvas || element === this.containerElement) return
    this._resizeObserver?.disconnect()
    this.containerElement = element
    element.appendChild(this.canvas)
    this._resizeObserver?.observe(element)
    this.handleWindowResize()
  }

  public static get _(): Catalyst {
    return Catalyst.getInstance()
  }

  public get unit(): number {
    return this._unit
  }

  public set unit(size: number) {
    this._unit = size
  }

  public get camera(): CatalystCamera | undefined {
    return this._camera
  }

  public get scene(): THREE.Scene {
    return this._scene
  }

  public get renderer(): THREE.WebGLRenderer | undefined {
    return this._renderer
  }

  /**
   * When on, a frame is only drawn if the camera moved, something called
   * requestRender() since the last draw, or the pixel ratio changed. Update
   * and the render signals still run every frame.
   */
  public get renderOnDemand(): boolean {
    return this._renderOnDemand
  }

  public set renderOnDemand(on: boolean) {
    this._renderOnDemand = on
    this._renderRequested = true
  }

  public requestRender(): void {
    this._renderRequested = true
  }

  public get physics(): VeloraEnvironment | undefined {
    return this._physics
  }

  public get input(): Helm | undefined {
    return this._input
  }

  public get ui(): Slate | undefined {
    return this._ui
  }

  public get reQuester(): reQuester {
    return this._reQuester
  }

  public get nodes(): Record<string, any> {
    return this._nodeRegistry
  }

  public get signals(): CatalystSignals {
    return this._signals as unknown as CatalystSignals
  }

  public get targetFPS(): number | null {
    return this._targetFPS
  }

  public set targetFPS(fps: number | null) {
    this._targetFPS = fps
    this._frameInterval = fps ? 1000 / fps : 0
    this._lastFrameTime = 0
  }

  public pause(): void {
    this._shouldUpdate = false
    this._input.pause()
  }

  public resume(): void {
    this._shouldUpdate = true
    this._renderRequested = true
    this._input.resume()
    this.handleWindowResize()
  }

  public get resolution(): ResolutionSettings {
    return this._resolution.settings
  }

  public set resolution(settings: ResolutionSettings) {
    this._resolution.settings = settings
  }

  public get frameCount(): number {
    return this._frameCount
  }

  public get elapsed(): number {
    return performance.now() - (this._startTime ?? performance.now())
  }

  /**
   * Initialise the engine and all systems.
   */
  public async initialise(): Promise<void> {
    debug("Catalyst Engine initialising...", "Catalyst")
  }

  //=========================
  // Game loop
  //=========================

  /**
   * Start the game loop.
   */
  public start(): void {
    if (this.isRunning) {
      debug("Catalyst is already running", "warning")
      return
    }

    this._startTime = performance.now()
    this.isRunning = true

    this.gameLoop.start((deltaTime: number) => {
      if (this._shouldUpdate) {
        if (this._targetFPS) {
          const now = performance.now()
          const elapsed = now - this._lastFrameTime
          if (elapsed < this._frameInterval) return
          this._lastFrameTime = now - (elapsed % this._frameInterval)
          this.update(elapsed)
          this.render(elapsed)
        } else {
          this.update(deltaTime)
          this.render(deltaTime)
        }
      }
    })

    // Only subscribe camera if renderer is active
    if (this._camera) {
      this._camera.subscribeToRenderLoop()
    }

    this._signals.onStart.emit({ timestamp: this._startTime! })
    debug("Catalyst Engine started", "Catalyst")
  }

  /**
   * Stop the game loop.
   */
  public stop(): void {
    if (!this.isRunning) {
      debug("Catalyst is not running", "warning")
      return
    }

    debug("Catalyst Engine stopped", "Catalyst")
    this.isRunning = false
    this.gameLoop.stop()
  }

  /**
   * Update all systems.
   * Called once per frame by the game loop.
   * Broadcasts onUpdate signal.
   */
  private update(deltaTime: number): void {
    this._frameCount++
    if (this._physics) {
      this._physics.update(deltaTime)
    }
    this._signals.onUpdate.emit({ deltaTime })
  }

  /**
   * Render the frame.
   * Called once per frame by the game loop.
   * Broadcasts onRender signal.
   */
  private render(deltaTime: number): void {
    this._signals.onRender.emit({ deltaTime })
    if (this._renderer && this._scene && this._camera) {
      const cameraMoved = this._camera.isDirty
      const ratioBefore = this._renderer.getPixelRatio()
      this._resolution.update(
        this._renderer,
        cameraMoved,
        this._frameInterval || 1000 / 60
      )
      const draw =
        !this._renderOnDemand ||
        this._renderRequested ||
        cameraMoved ||
        this._renderer.getPixelRatio() !== ratioBefore
      if (draw) {
        this._renderRequested = false
        this._renderer.render(this._scene, this._camera.view)
      }
    }
    this._signals.onPostRender.emit({ deltaTime })
  }

  /**
   * Check if the engine is currently running.
   */
  public getIsRunning(): boolean {
    return this.isRunning
  }

  /**
   * Cleanup and shutdown the engine.
   */
  public async shutdown(): Promise<void> {
    debug("Catalyst Engine shutting down...", "Catalyst")
    this.stop()
    window.removeEventListener("resize", this.handleWindowResize)
    this._resizeObserver?.disconnect()
    this.canvas.remove()
    this._signals.onUpdate.clear()
    this._signals.onRender.clear()
    if (this.renderer) this.renderer.dispose()
  }
}
