import { defineConfig } from "vite"
import { catalystViteConfig } from "@vitrine/catalyst/vite"

const catalyst = catalystViteConfig()

// The editor is a debug build by nature: debug() output, the move mode behind
// the `o` key and the benchmark harness all stay in.
export default defineConfig({
  ...catalyst,
  publicDir: "../player/public",
  define: {
    __DEBUG__: true,
  },
  server: { ...catalyst.server, port: 3100 },
  preview: { ...catalyst.preview, port: 4174 },
})
