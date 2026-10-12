import { fileURLToPath } from "node:url"

const empty = fileURLToPath(new URL("./patch/empty.js", import.meta.url))

const crossOriginIsolation = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
}

/**
 * Vite config fragment every Catalyst app needs: cross-origin isolation for the
 * WASM/worker splat pipeline, ES module workers, .wasm as assets, and stubs for
 * the three.js example loaders that Addons.js would otherwise pull in.
 */
export const catalystViteConfig = () => ({
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  resolve: {
    alias: {
      "three/examples/jsm/loaders/3DMLoader.js": empty,
      "three/examples/jsm/loaders/DRACOLoader.js": empty,
      "three/examples/jsm/loaders/collada/ColladaParser.js": empty,
    },
  },
  assetsInclude: ["**/*.wasm"],
  worker: { format: "es" },
})
