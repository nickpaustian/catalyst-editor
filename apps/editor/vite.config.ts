import { defineConfig } from "vite"
import { lightspeedPlugin } from "@lightspeed-js/core/vite"
import { rustEngineAlias, rustEngineAllow } from "./rust-engine.ts"

const crossOriginIsolation = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
}

// Lightspeed compiles the panel's components, the editor package's and any
// recipe's; host mode leaves this app's index.html alone. The engine is the
// Rust runtime, aliased over the TypeScript engine's package names.
export default defineConfig({
  plugins: [lightspeedPlugin({ typescript: true, host: true, componentDirs: ["../../packages/editor/src/components"] })],
  resolve: { alias: rustEngineAlias() },
  server: { headers: crossOriginIsolation, port: 3100, fs: { allow: ["../..", ...rustEngineAllow()] } },
  preview: { headers: crossOriginIsolation, port: 4174 },
  worker: { format: "es" },
  build: { rollupOptions: { input: { editor: "index.html", play: "play.html", start: "start.html" } } },
})
