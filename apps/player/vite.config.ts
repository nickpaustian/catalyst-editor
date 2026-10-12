import { defineConfig, loadEnv } from "vite"
import { catalystViteConfig } from "@vitrine/catalyst/vite"
import { stripDebug } from "@vitrine/debug/vite"

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
    plugins: [!isDebugEnabled && stripDebug()].filter(Boolean),
  }
})
