/**
 * The wasm engine's package, `@nickpaustian/catalyst-rs`, as the editor uses it. Declared here so the
 * editor compiles whether or not the package is linked (`npm run link:rust`); the app's Vite config
 * points the import at a stub when it is not.
 */
declare module "@nickpaustian/catalyst-rs" {
  export class Engine {
    constructor()
    free(): void
    root(): number
    create_tree(json: string): number
    add_node(parent: number, child: number, key: string | undefined, index: number): string
    free_node(id: number): void
    set_local(id: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number, sx: number, sy: number, sz: number): void
    node_name(id: number): string | undefined
    node_kind(id: number): string | undefined
    parent_of(id: number): number | undefined
    children_of(id: number): Uint32Array
    is_internal(id: number): boolean
    get_property(id: number, key: string): string
    set_property(id: number, key: string, json: string): boolean
    serialise(id: number): string
    end_frame(): number
  }
  export class Viewport {
    free(): void
    resize(width: number, height: number): void
    width(): number
    height(): number
    provide_file(url: string, bytes: Uint8Array): void
    forget_file(url: string): void
    missing_files(): string[]
    retry_assets(engine: Engine): void
    apply_environment(engine: Engine): void
    set_grid(size: number, colour: number): void
    set_highlight(ids: Uint32Array | number[]): void
    set_highlight_colour(colour: number): void
    set_host_camera(on: boolean): void
    fit(engine: Engine): void
    orbit(dx: number, dy: number, pan: boolean): void
    zoom(notches: number, u: number, v: number): void
    render(engine: Engine, dt: number, step: boolean, pose: string | undefined): void
    camera_json(): string
    pick(engine: Engine, u: number, v: number): string
    ground_point(u: number, v: number, height: number): string
    scene_stats(): string
  }
  export function create_viewport(canvas: HTMLCanvasElement, background: number, sampleCount?: number): Promise<Viewport>
  /** Load the wasm; call once before anything else. */
  export default function init(): Promise<unknown>
}
