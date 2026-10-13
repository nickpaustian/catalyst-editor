import { defineConfig } from "vite"
import { catalystViteConfig } from "@vitrine/catalyst/vite"
import { lightspeedPlugin } from "@lightspeed-js/core/vite"

const catalyst = catalystViteConfig()

// The editor is a debug build by nature: debug() output, the move mode behind
// the `o` key and the benchmark harness all stay in.
export default defineConfig({
  ...catalyst,
  publicDir: "../player/public",
  define: {
    __DEBUG__: true,
  },
  // Lightspeed compiles the panel's .lsp components; host mode leaves this
  // app's own index.html and routing alone
  plugins: [lightspeedPlugin({ typescript: true, host: true })],
  server: { ...catalyst.server, port: 3100 },
  preview: { ...catalyst.preview, port: 4174 },
})
