import { existsSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * The editor runs on either engine, chosen when it is built: the TypeScript engine by default (the stable one
 * projects ship on), or the Rust one with `CATALYST_ENGINE=rust`: `@nickpaustian/catalyst-rs/runtime`, linked by
 * `npm run link:rust` from a `scripts/build-wasm.sh` build of the catalyst-rs repository. The engine packages'
 * names stay in the source, so the Rust alias points each of them, and their subpaths, at the runtime.
 */
export const RUNTIME = "@nickpaustian/catalyst-rs/runtime"

export type Engine = "ts" | "rust"

export const ENGINE: Engine = process.env.CATALYST_ENGINE === "rust" ? "rust" : "ts"

export const rustEngineAlias = (): { find: RegExp; replacement: string }[] => [
  { find: /^@nickpaustian\/catalyst(\/.*)?$/, replacement: RUNTIME },
  { find: /^@nickpaustian\/obelisk(\/.*)?$/, replacement: RUNTIME },
]

/** The alias for the engine chosen: the Rust runtime over the package names, or none for the TypeScript engine. */
export const engineAlias = (): { find: RegExp; replacement: string }[] => (ENGINE === "rust" ? rustEngineAlias() : [])

/** The linked package's real folder, which the dev server must be allowed to serve the wasm from. */
export const rustEngineAllow = (): string[] => {
  const link = fileURLToPath(new URL("../../node_modules/@nickpaustian/catalyst-rs", import.meta.url))
  return existsSync(link) ? [realpathSync(link)] : []
}
