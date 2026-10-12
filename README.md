# Vitrine

Platform for publishing scanned exhibitions as streamed Gaussian-splat experiences. **Vitrine** is the editor; the player app is the visitor-facing side. Both are built from the Beruk virtual exhibition, which is the reference implementation.

## Layout

npm workspace. Packages are consumed from source (no build step); each app's Vite build bundles what it imports.

| Path | Package | What it is |
| --- | --- | --- |
| `packages/debug` | `@vitrine/debug` | `debug()` logging, the `__DEBUG__` global and the Vite plugin that strips `debug()` calls from release builds |
| `packages/stelligra` | `@vitrine/stelligra` | Gaussian splat renderer, sort worker and the `stelligra-wasm` SOG decoder |
| `packages/catalyst` | `@vitrine/catalyst` | Scene engine: Catalyst, with Helm (input), Velora (physics), Slate (UI) and reQuester (fetch) as subpath exports |
| `packages/spektra` | `@vitrine/spektra` | Expandable image viewer used by modal content |
| `packages/telemetry` | `@vitrine/telemetry` | Debug widgets |
| `packages/runtime` | `@vitrine/runtime` | Exhibition manifest schema and loader, and the managers that run an exhibition from one |
| `apps/player` | `@vitrine/player` | The visitor app: static catalogue plus the runtime |

## Running

```sh
npm install
npm run build:wasm     # once per machine: builds packages/stelligra/stelligra-wasm/pkg with wasm-pack
npm run dev            # player on http://localhost:3000
npm run typecheck
npm run build          # apps/player/dist
```

`VITE_DEBUG=true` in `apps/player/.env` keeps `debug()` output, the telemetry widgets, the benchmark harness and the debug keys. Release builds need it off (the committed `.env.example` has it off).

The dev and preview servers send cross-origin isolation headers; the WASM/worker splat pipeline needs them, so any other host must send them too.

## Exhibitions

An exhibition is a folder with a `manifest.json` (schema in `packages/runtime/src/manifest/types.ts`), its scene node files, baked camera path and HTML content. The player lists exhibitions from `apps/player/public/exhibitions/index.json` and loads one with `?exhibition=<id>`, defaulting to the first. Beruk is at `apps/player/public/exhibitions/beruk/`.
