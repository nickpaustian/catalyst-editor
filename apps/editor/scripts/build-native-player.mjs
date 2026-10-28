// The native player bundle: native/main.ts and everything it imports in one ES module for the runner's QuickJS,
// with the engine packages pointed at the Rust runtime's native build, as the editor's Vite config points them at
// its browser build.
import * as esbuild from "esbuild"
import { existsSync, realpathSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const link = resolve(here, "../../../node_modules/@nickpaustian/catalyst-rs")
if (!existsSync(link)) {
  console.error("build-native-player: @nickpaustian/catalyst-rs is not linked; run `npm run link:rust` after a catalyst-rs build")
  process.exit(1)
}
const native = resolve(realpathSync(link), "native.js")
const runtimeAlias = { name: "rust-engine-native", setup: (build) => build.onResolve({ filter: /^@nickpaustian\/(catalyst|obelisk)(\/.*)?$/ }, () => ({ path: native })) }

await esbuild.build({
  entryPoints: [resolve(here, "../native/main.ts")],
  outfile: resolve(here, "../public/native-player/player.js"),
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "neutral",
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  logLevel: "warning",
  plugins: [runtimeAlias],
})
console.log("built public/native-player/player.js")
