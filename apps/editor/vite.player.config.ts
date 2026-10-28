import { readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { defineConfig, type Plugin } from "vite"
import { lightspeedPlugin } from "@lightspeed-js/core/vite"
import { rustEngineAlias } from "./rust-engine.ts"

const OUT = new URL("./public/player/", import.meta.url).pathname

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]))

/** `files.json` lists the build, so an export knows what to copy without a directory listing from the server. */
const fileList = (): Plugin => ({
  name: "player-file-list",
  closeBundle() {
    const files = walk(OUT).map((file) => relative(OUT, file)).filter((file) => file !== "files.json" && !file.endsWith(".DS_Store"))
    writeFileSync(join(OUT, "files.json"), JSON.stringify(files, null, 2) + "\n")
  },
})

// The published page's runtime, built once into public/ so the editor can copy it in dev and in a build alike. The
// engine is the Rust runtime, as the editor's; its wasm is emitted as an asset of the build.
export default defineConfig({
  root: new URL("./player/", import.meta.url).pathname,
  base: "./",
  plugins: [lightspeedPlugin({ typescript: true, host: true, componentDirs: ["../../packages/editor/src/components"] }), fileList()],
  resolve: { alias: rustEngineAlias() },
  worker: { format: "es" },
  build: { outDir: OUT, emptyOutDir: true },
})
