import { debug } from "../utils"

import BaseManager from "./BaseManager"
import { AssetManager } from "./AssetManager"
import PreferenceManager from "./PreferenceManager"
import SceneManager from "./SceneManager"
import Telemetry from "@vitrine/telemetry"
import StateManager from "./StateManager"
import UiManager from "./UiManager"
import GameManager from "./GameManager"
import AudioManager from "./AudioManager"
import { Modal } from "./Modal"
import setupTelemetry from "../debug/setupTelemetry"
import type { LoadedManifest } from "../manifest"
import { buildContent, type ExhibitionContent } from "../content/templates"

const debugEnabled = import.meta.env.VITE_DEBUG === "true"

let telemetry: Telemetry | null = null

/** The managers for one loaded exhibition. One registry is current at a time. */
export default class ManagerRegistry {
  private static instance: ManagerRegistry | null = null
  private isInitialised: boolean = false
  private _disposed: boolean = false

  private managers: BaseManager[] = []

  public readonly manifest: LoadedManifest
  public readonly content: ExhibitionContent

  public assets: AssetManager
  public preferences: PreferenceManager
  public scene: SceneManager
  public state: StateManager
  public ui: UiManager
  public game: GameManager
  public telemetry!: Telemetry
  public audio: AudioManager

  private constructor(manifest: LoadedManifest) {
    debug("Begin managers registration", "init")

    this.manifest = manifest
    this.content = buildContent(manifest)

    this.assets = new AssetManager()
    this.preferences = PreferenceManager.getInstance()
    this.scene = new SceneManager()
    this.state = new StateManager()
    this.game = new GameManager()
    this.ui = new UiManager(manifest)
    this.audio = new AudioManager({
      groups: ["background", "ui"],
      initialGroupVolumes: {
        background: 1.0,
        ui: 1.0,
      },
    })

    if (debugEnabled) {
      telemetry ??= setupTelemetry()
      this.telemetry = telemetry
    }

    this.managers = [this.assets, this.preferences, this.scene]
  }

  /** Creates the registry for an exhibition. The previous one must be disposed first. */
  public static create(manifest: LoadedManifest): ManagerRegistry {
    if (ManagerRegistry.instance) {
      throw new Error("Dispose the current ManagerRegistry before creating another")
    }
    ManagerRegistry.instance = new ManagerRegistry(manifest)
    ManagerRegistry.instance.init()
    return ManagerRegistry.instance
  }

  public static getInstance(): ManagerRegistry {
    if (!ManagerRegistry.instance) {
      throw new Error("No exhibition is loaded")
    }

    return ManagerRegistry.instance
  }

  public static get _(): ManagerRegistry {
    return this.getInstance()
  }

  public static get current(): ManagerRegistry | null {
    return ManagerRegistry.instance
  }

  public get isDisposed(): boolean {
    return this._disposed
  }

  private init(): void {
    if (this.isInitialised) return
    this.isInitialised = true

    debug("Managers Initialised", "init")
    this.managers.forEach((manager) => {
      manager.setManagers(this)
    })
  }

  /** Tears the exhibition down and leaves the engine running for the next one. */
  public async dispose(): Promise<void> {
    if (this._disposed) return
    this._disposed = true

    await Modal._.reset()
    this.scene.dispose()
    this.ui.dispose()
    this.audio.dispose()

    if (ManagerRegistry.instance === this) ManagerRegistry.instance = null
    debug(`Managers disposed for ${this.manifest.id}`, "init")
  }
}
