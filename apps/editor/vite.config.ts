import { defineConfig } from "vite"
import { lightspeedPlugin } from "@lightspeed-js/core/vite"

const crossOriginIsolation = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
}

// Lightspeed compiles the panel's components, the editor package's and any
// recipe's; host mode leaves this app's index.html alone. The engine packages
// are file links, so three is pinned to one copy.
export default defineConfig({
  plugins: [lightspeedPlugin({ typescript: true, host: true, componentDirs: ["../../packages/editor/src/components"] })],
  resolve: { dedupe: ["three"] },
  server: { headers: crossOriginIsolation, port: 3100, fs: { allow: ["../.."] } },
  preview: { headers: crossOriginIsolation, port: 4174 },
  worker: { format: "es" },
  build: { rollupOptions: { input: { editor: "index.html", play: "play.html", start: "start.html" } } },
})
