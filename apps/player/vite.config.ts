import { defineConfig, loadEnv } from "vite"
import { catalystViteConfig } from "@vitrine/catalyst/vite"
import { stripDebug } from "@vitrine/debug/vite"
import { lightspeedPlugin } from "@lightspeed-js/core/vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const isDebugEnabled = env.VITE_DEBUG === "true"
  const catalyst = catalystViteConfig()

  return {
    ...catalyst,
    define: {
      __DEBUG__: isDebugEnabled,
    },
    server: { ...catalyst.server, port: 3000 },
    preview: { ...catalyst.preview, port: 4173 },
    // Lightspeed compiles the catalogue island; host mode leaves index.html alone
    plugins: [lightspeedPlugin({ typescript: true, host: true }), !isDebugEnabled && stripDebug()].filter(Boolean),
  }
})
