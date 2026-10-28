import { existsSync, realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * The Rust engine's package is linked by hand (`npm run link:rust`), so a build without it
 * points the import at a stub whose loader fails, and the editor keeps to the TypeScript engine.
 */
export const rustEngineAlias = (): Record<string, string> => {
  const linked = existsSync(fileURLToPath(new URL("../../node_modules/@nickpaustian/catalyst-rs/package.json", import.meta.url)))
  return linked ? {} : { "@nickpaustian/catalyst-rs": fileURLToPath(new URL("./src/no-rust-engine.ts", import.meta.url)) }
}

/** The linked package's real folder, which the dev server must be allowed to serve the wasm from. */
export const rustEngineAllow = (): string[] => {
  const link = fileURLToPath(new URL("../../node_modules/@nickpaustian/catalyst-rs", import.meta.url))
  return existsSync(link) ? [realpathSync(link)] : []
}
