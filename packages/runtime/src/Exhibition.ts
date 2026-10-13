import ManagerRegistry from "./managers/ManagerRegistry"
import { loadManifest, type LoadedManifest } from "./manifest"
import { debug } from "./utils"

/** One loaded exhibition: its manifest and managers, disposable as a unit. */
export class Exhibition {
  public readonly manifest: LoadedManifest
  public readonly managers: ManagerRegistry

  private constructor(manifest: LoadedManifest, managers: ManagerRegistry) {
    this.manifest = manifest
    this.managers = managers
  }

  /** Stands the exhibition up in `#app`. Only one can be live at a time. */
  public static async load(manifestUrl: string): Promise<Exhibition> {
    return Exhibition.loadFrom(await loadManifest(manifestUrl))
  }

  /** Same, from a manifest whose paths are already resolved (e.g. a folder). */
  public static loadFrom(manifest: LoadedManifest): Exhibition {
    debug(`Loaded manifest for ${manifest.id}`, "init")

    document.title = manifest.title

    const managers = ManagerRegistry.create(manifest)

    managers.scene.setup()
    managers.scene.loadAssets()

    if (__DEBUG__) {
      import("./debug/setupBenchmark").then(({ default: setupBenchmark }) =>
        setupBenchmark(managers)
      )
    }

    return new Exhibition(manifest, managers)
  }

  /** Resolves once the scene is built; assets may still be streaming. */
  public get ready(): Promise<void> {
    return this.managers.scene.ready
  }

  public get isDisposed(): boolean {
    return this.managers.isDisposed
  }

  public async dispose(): Promise<void> {
    await this.managers.dispose()
  }
}

/**
 * Owns the live exhibition. The engine (Catalyst, its canvas and singletons)
 * stays up across loads; each exhibition builds and tears down its own scene.
 */
export class Player {
  private _current: Exhibition | null = null
  private pending: Promise<Exhibition> | null = null

  public get current(): Exhibition | null {
    return this._current
  }

  /** Disposes whatever is loaded, then loads `manifestUrl`. */
  public load(manifestUrl: string): Promise<Exhibition> {
    return this.swapTo(() => Exhibition.load(manifestUrl))
  }

  /** Disposes whatever is loaded, then loads an already-resolved manifest. */
  public loadManifest(manifest: LoadedManifest): Promise<Exhibition> {
    return this.swapTo(async () => Exhibition.loadFrom(manifest))
  }

  private async swapTo(make: () => Promise<Exhibition>): Promise<Exhibition> {
    const run = (async () => {
      await this.pending?.catch(() => undefined)
      await this.dispose()
      const exhibition = await make()
      this._current = exhibition
      return exhibition
    })()
    this.pending = run
    try {
      return await run
    } finally {
      if (this.pending === run) this.pending = null
    }
  }

  public async dispose(): Promise<void> {
    const current = this._current
    this._current = null
    await current?.dispose()
  }
}

/** Convenience for a page that shows one exhibition. */
export const runExhibition = (manifestUrl: string): Promise<Exhibition> =>
  new Player().load(manifestUrl)
