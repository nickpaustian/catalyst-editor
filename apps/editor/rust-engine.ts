import { existsSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * The editor's engine is the Rust one: `@nickpaustian/catalyst-rs/runtime`, linked by `npm run link:rust`
 * from a `scripts/build-wasm.sh` build of the catalyst-rs repository. The engine packages' names stay in the
 * source, so the alias points each of them, and their subpaths, at the runtime.
 */
export const RUNTIME = "@nickpaustian/catalyst-rs/runtime"

export const rustEngineAlias = (): { find: RegExp; replacement: string }[] => [
  { find: /^@nickpaustian\/catalyst(\/.*)?$/, replacement: RUNTIME },
  { find: /^@nickpaustian\/obelisk(\/.*)?$/, replacement: RUNTIME },
]

/** The linked package's real folder, which the dev server must be allowed to serve the wasm from. */
export const rustEngineAllow = (): string[] => {
  const link = fileURLToPath(new URL("../../node_modules/@nickpaustian/catalyst-rs", import.meta.url))
  return existsSync(link) ? [realpathSync(link)] : []
}
