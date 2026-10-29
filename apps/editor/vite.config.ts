import { defineConfig } from "vite"
import { lightspeedPlugin } from "@lightspeed-js/core/vite"
import { ENGINE, engineAlias, rustEngineAllow } from "./rust-engine.ts"

const crossOriginIsolation = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
}

// Lightspeed compiles the panel's components, the editor package's and any
// recipe's; host mode leaves this app's index.html alone. The engine is the
// TypeScript one, or the Rust runtime aliased over its package names with
// `CATALYST_ENGINE=rust` (`npm run dev:rust`), on its own port so both can run.
export default defineConfig({
  plugins: [lightspeedPlugin({ typescript: true, host: true, componentDirs: ["../../packages/editor/src/components"] })],
  resolve: { alias: engineAlias() },
  server: { headers: crossOriginIsolation, port: Number(process.env.CATALYST_PORT ?? (ENGINE === "rust" ? 3110 : 3100)), fs: { allow: ["../..", ...rustEngineAllow()] } },
  preview: { headers: crossOriginIsolation, port: 4174 },
  worker: { format: "es" },
  build: { rollupOptions: { input: { editor: "index.html", play: "play.html", start: "start.html" } } },
})
