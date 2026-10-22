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

The scene recipe adds boxes, spheres and capsules (a mesh with a matching collider, for blocking in), colliders on their own, interactables, points of interest, focal points and triggers, cameras, groups and a player start. Its project is a folder with `scene.json`, a node tree in Catalyst's scene file format, plus whatever files it names (relative paths are read from the folder, absolute URLs from the network). The file also carries the scene's **environment**: a physics floor (on by default at y 0, so nothing needs a floor plane to stand on), gravity and drag, edited in the panel's Environment section. File → New project starts one in memory; Save as… picks the folder.

## Running a project

**Run** in the menu bar, or ⌘R / Ctrl+R while the editor has focus (Safari keeps that key for reload; use the button there), opens `play.html` in a window of its own and plays the scene as it is in the editor, unsaved edits included. The editor sends the serialised scene and the project folder's handle, so the runner reads the same files; a second run swaps the scene in the same window. The scene recipe puts a first person player at the **Player start** node, or the first camera, or the origin, and lets physics go. A recipe's `run(context)` does whatever playing means for it and returns a teardown.

## A recipe

```ts
interface Recipe {
  name: string
  modules?: () => Module[]        // installed on the engine beyond the core set
  kinds: NodeKind[]               // what the tree can add: { kind, label, cls, make }
  panel?: string[]                // Lightspeed component ids mounted under the scene sections
  load(folder, engine): Promise<Node3D>
  save(folder, root, engine): Promise<string[]>
  settings?: { title, fields, read, write }  // project-wide values shown as fields
  serialise?(root, engine): NodeJSON  // the whole document; what a run is sent
  download?(root, engine): { name, text }
  run(context): Promise<() => void>  // play it in the runner window
}
```

A recipe's kinds are registered with the engine under their names, so a scene file can name them. Its panel components live in a `componentDirs` entry of the app's Lightspeed plugin and talk to the session the same way the built-in ones do: read the `editor:*` shared cells, send commands through `sendCommand`.

## Editing

Orbit: drag to orbit, right-drag to pan, wheel to zoom. F focuses the selected node, Delete removes it, the gizmo moves or rotates it (View menu). Snapping is on by default, a quarter unit and 15°, with the steps in the View menu; holding Shift during a drag gives the opposite of the setting, and the setting is remembered per browser. Shift-click in the tree selects a range, ctrl- or cmd-click toggles one, and a dragged row drops before, after or inside another with its world transform kept. Fields come from each node class's exposed properties; number fields scrub sideways. Every change can be undone and redone (Edit menu, ⌘Z and ⌘⇧Z): a gizmo drag is one step, a scrub is one step, and the project counts as clean again when undo reaches the saved state. Physics is held still while editing (View → Physics running lets it go).
