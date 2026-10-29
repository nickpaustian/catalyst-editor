import * as catalyst from "@nickpaustian/catalyst"

/** The engine made ready: the Rust runtime loads its wasm first; the TypeScript engine has nothing to wait for. */
export const boot = (): Promise<void> => ("boot" in catalyst ? (catalyst as unknown as { boot(): Promise<void> }).boot() : Promise.resolve())
