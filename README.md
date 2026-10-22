# Vitrine

An editor for Catalyst projects: open a folder, see its scene as a tree, select, move with a gizmo, edit what each node exposes, add and remove nodes, save. What a project *is* comes from a **recipe**: the node kinds it adds, the panel sections it shows, and how its folder becomes a scene and back. A plain Catalyst scene is the built-in recipe; an exhibition (the Beruk work this grew from) is the next.

## Layout

npm workspace. The editor packages are consumed from source; the engine packages are file links to their repos until they are published.

| Path | Package | What it is |
| --- | --- | --- |
| `packages/editor` | `@vitrine/editor` | The editor: `EditorSession` (tree, selection, fields, add, delete, move, rename, save), `EditorCamera` (orbit and gizmo), `ProjectFolder` and `folderLoader` (File System Access), the `Recipe` interface and the `sceneRecipe`, the pane layout, preferences, and the Lightspeed panel components |
| `apps/editor` | `@vitrine/editor-app` | The app: makes the engine with the core modules (physics, input, interaction, resources, splats), mounts the panel and menu bar, and runs a session under a recipe |
| `apps/editor/exhibition` | | The exhibition editor's sections and session as they were, kept as the reference for the exhibition recipe |
| `packages/runtime`, `apps/player`, and the vendored `packages/catalyst`, `stelligra`, `spektra`, `telemetry`, `assets`, `debug` | | The exhibition player and its copies of the engine, as ported from Beruk. They go once the exhibition recipe runs on the published packages |

The engine comes from `@nickpaustian/catalyst` and its peers (`helm`, `velora`, `signal`, `requester`, `@stelligra/core`) as `file:` links to the sibling repos. Vite dedupes `three` so the links and the app share one copy, and the app's `tsconfig` maps `three` to one set of types.

## Running

```sh
npm install
npm run dev:editor     # http://localhost:3100
npm run typecheck
```

The dev server sends cross-origin isolation headers for the splat worker pipeline, so any other host must send them too. The File System Access API (Chrome and Edge) is needed to open and save folders; elsewhere the scene file is offered as a download.

## A project

The scene recipe's project is a folder with `scene.json`, a node tree in Catalyst's scene file format, plus whatever files it names (relative paths are read from the folder, absolute URLs from the network). File → New project starts one in memory; Save as… picks the folder.

## A recipe

```ts
interface Recipe {
  name: string
  modules?: () => Module[]        // installed on the engine beyond the core set
  kinds: NodeKind[]               // what the tree can add: { kind, label, cls, make }
  panel?: string[]                // Lightspeed component ids mounted under the scene sections
  load(folder, engine): Promise<Node3D>
  save(folder, root, engine): Promise<string[]>
  download?(root, engine): { name, text }
}
```

A recipe's kinds are registered with the engine under their names, so a scene file can name them. Its panel components live in a `componentDirs` entry of the app's Lightspeed plugin and talk to the session the same way the built-in ones do: read the `editor:*` shared cells, send commands through `sendCommand`.

## Editing

Orbit: drag to orbit, right-drag to pan, wheel to zoom. F focuses the selected node, Delete removes it, the gizmo moves or rotates it (View menu). Shift-click in the tree selects a range, ctrl- or cmd-click toggles one, and a dragged row drops before, after or inside another with its world transform kept. Fields come from each node class's exposed properties; number fields scrub sideways. Physics is held still while editing (View → Physics running lets it go).
