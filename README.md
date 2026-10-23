# Catalyst editor

An editor for Catalyst projects: open a folder, see its scene as a tree, select, move with a gizmo, edit what each node exposes, add and remove nodes, save. What a project *is* comes from a **recipe**: the node kinds it adds, the panel sections it shows, and how its folder becomes a scene and back. A plain Catalyst scene is the built-in recipe; an exhibition (the Beruk work this grew from) is the next.

## Layout

npm workspace. The editor packages are consumed from source; the engine packages come from npm.

| Path | Package | What it is |
| --- | --- | --- |
| `packages/editor` | `@nickpaustian/catalyst-editor` | The editor: `EditorSession` (tree, selection, fields, add, delete, move, rename, save), `EditorCamera` (orbit and gizmo), `ProjectFolder` and `folderLoader` (File System Access), the `Recipe` interface and the `sceneRecipe`, the pane layout, preferences, and the Lightspeed panel components |
| `apps/editor` | `catalyst-editor-app` | The app: makes the engine with the core modules (physics, input, interaction, resources, splats), mounts the scene pane, the inspector and the menu bar, and runs a session under a recipe |
| `apps/editor/exhibition` | | The exhibition editor's sections and session as they were, kept as the reference for the exhibition recipe |
| `packages/runtime`, `apps/player`, and the vendored `packages/catalyst`, `stelligra`, `spektra`, `telemetry`, `assets`, `debug` | | The exhibition player and its copies of the engine, as ported from Beruk. They go once the exhibition recipe runs on the published packages |

The engine comes from `@nickpaustian/catalyst` and its peers (`helm`, `velora`, `signal`, `requester`, `@nickpaustian/stelligra`) from npm. Vite dedupes `three` so the packages and the app share one copy, and the app's `tsconfig` maps `three` to one set of types.

## Running

```sh
npm install
npm run dev:editor     # http://localhost:3100
npm run typecheck
```

The dev server sends cross-origin isolation headers for the splat worker pipeline, so any other host must send them too. The File System Access API (Chrome and Edge) is needed to open and save folders; elsewhere the scene file is offered as a download.

## A project

A project is a folder. It lives in one of two places:

- **In the browser.** File → New project makes one in the browser's own storage (the origin private file system), which every current browser has. Files you import are copied into it, and the runner reads them from there. Nothing touches your disk; an export will bundle it up when the time comes.
- **On disk.** File → Open folder… and Save as… use the File System Access API, which Chrome, Edge and other Chromium browsers have and Safari and Firefox do not. The folder is yours: `scene.json` and an `assets/` directory beside whatever else you keep there, readable by the runner and by any other tool.

Either way the scene recipe's project holds `scene.json`, a node tree in Catalyst's scene file format with the scene's **environment** beside it (a physics floor, on by default at y 0, gravity and drag), and the files it names, read from the folder by relative path and from the network by URL.

The scene recipe adds boxes, spheres and capsules (a mesh with a matching collider, for blocking in), **models** (a `.glb` imported into `assets/` and placed at the node) and **Gaussian splats** (a `.sog` or `.ply`, likewise), colliders on their own, interactables, points of interest, focal points and triggers, cameras, groups and a player start. A kind that needs a file asks for it when added and copies it into the project.

## Running a project

**Run** in the menu bar, or ⌘R / Ctrl+R while the editor has focus (Safari keeps that key for reload; use the button there), opens `play.html` in a window of its own and plays the scene as it is in the editor, unsaved edits included. The editor sends the serialised scene and the project folder's handle, so the runner reads the same files; a second run swaps the scene in the same window. The scene recipe puts a first person player at the **Player start** node, or the first camera, or the origin, and lets physics go. A recipe's `run(context)` does whatever playing means for it and returns a teardown.

## A recipe

```ts
interface Recipe {
  name: string
  modules?: () => Module[]        // installed on the engine beyond the core set
  kinds: NodeKind[]               // what the tree can add: { kind, label, cls, description, pick?, make }
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

Three panes: the scene tree on the left, the viewport, and the inspector on the right with the selected node's fields, the environment and any recipe sections. Drag a gutter to resize, a pane's title to move it (a pane moved to the other side keeps its width, the others taking back the room they gained; stacked above or below another it takes that pane's width and half its height); + adds a closed pane back, × closes one; View → Reset pane layout restores the default.

Orbit: drag to orbit, right-drag to pan, wheel to zoom. F focuses the selected node, Delete removes it, the gizmo moves or rotates it (View menu). Snapping is on by default, a quarter unit and 15°, with the steps in the View menu; holding Shift during a drag gives the opposite of the setting, and the setting is remembered per browser. Add node (⌘⇧A) opens a dialog with the kinds laid out as their class hierarchy, like Godot's: search, arrow keys and Enter, a recent list, a description for each, double-click to create; base classes that are not kinds show greyed as groups. Shift-click in the tree selects a range, ctrl- or cmd-click toggles one, and a dragged row drops before, after or inside another with its world transform kept. Fields come from each node class's exposed properties; number fields scrub sideways. Every change can be undone and redone (Edit menu, ⌘Z and ⌘⇧Z): a gizmo drag is one step, a scrub is one step, and the project counts as clean again when undo reaches the saved state. Physics is held still while editing (View → Physics running lets it go).
