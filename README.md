# Catalyst editor

An editor for Catalyst projects: open a folder, see its scene as a tree, select in the tree or by clicking in the viewport (⌘-click adds, empty space clears; a prefab's or primitive's parts select their owner), move with a gizmo, edit what each node exposes, add and remove nodes, save. What a project *is* comes from a **recipe**: the node kinds it adds, the panel sections it shows, and how its folder becomes a scene and back. A plain Catalyst scene is the built-in recipe; an exhibition (the Beruk work this grew from) is the next.

## Layout

npm workspace. The editor packages are consumed from source; the engine packages come from npm.

| Path | Package | What it is |
| --- | --- | --- |
| `packages/editor` | `@nickpaustian/catalyst-editor` | The editor: `EditorSession` (tree, selection, fields, add, delete, move, rename, save), `EditorCamera` (orbit and gizmo), `ProjectFolder` and `folderLoader` (File System Access), the `Recipe` interface and the `sceneRecipe`, the pane layout, preferences, and the Lightspeed panel components |
| `apps/editor` | `catalyst-editor-app` | The app: makes the engine with the core modules (physics, input, interaction, resources, splats), mounts the scene pane, the inspector and the menu bar, and runs a session under a recipe |
| `apps/desktop` | `catalyst-desktop` | The Tauri 2 shell: a native window around the same editor page, with projects as folders on disk through the fs and dialog plugins and the runner as a second window |
| `apps/editor/exhibition` | | The exhibition editor's sections and session as they were, kept as the reference for the exhibition recipe |
| `packages/runtime`, `apps/player`, and the vendored `packages/catalyst`, `stelligra`, `spektra`, `telemetry`, `assets`, `debug` | | The exhibition player and its copies of the engine, as ported from Beruk. They go once the exhibition recipe runs on the published packages |

The engine comes from `@nickpaustian/catalyst` and its peers (`helm`, `velora`, `signal`, `requester`, `@nickpaustian/stelligra`) from npm. Vite dedupes `three` so the packages and the app share one copy, and the app's `tsconfig` maps `three` to one set of types.

## The desktop app

`npm run dev:desktop` opens the editor in a native window (Tauri 2, Rust and Xcode's command line tools needed once) against the dev server, which it starts; `npm run build:desktop` makes `Catalyst.app` and a `.dmg` from the built editor. Inside the shell the page is the same, but projects are folders on disk opened through the system picker, read and written by path with no browser sandbox in the way, so a save is a real file and a refresh loses nothing; the last folder reopens without a permission click; scripts can be edited in any editor alongside the code pane; Run opens the runner as a second window; and the project folder is watched while it is open, so a script saved in another editor rebuilds in the scene (and refreshes the code pane when it is not mid-edit), a prefab file edited on disk rebuilds its instances, and the project file is re-read, with the editor's own writes left out. The scene file changing on disk reloads the project when there are no unsaved changes, and otherwise keeps them and says so; File → Reload from disk takes the disk's version. In a browser a folder on disk is polled every two seconds for the same changes, so the same project open in the desktop app and in Chrome follow each other's saves. The page tells which shell it is in at start-up (`apps/editor/src/desktop.ts`) and hands the session a `FolderSource` and a `RunnerLink` for it (`apps/editor/src/tauri.ts`); in a browser it uses the File System Access API and `postMessage` as before.

## Running

To work on the engine and the editor together, `npm run link:engine` symlinks `node_modules/@nickpaustian/catalyst` to the sibling `../catalyst` repo without touching package.json or the lockfile (run `npm run build -- --watch` there, since the package resolves to its `dist`); `npm run unlink` reinstalls from the lockfile and drops the link.

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

**Prefabs** are node trees saved as files. Edit → Make prefab writes the selected node and everything under it to `prefabs/<name>.json` and puts an instance in its place: a `Prefab` node that holds only the file's path and a transform, and builds a copy of the file when it enters the scene. The project's prefab files appear in the add dialog under Prefabs, so a scene can hold many copies, and the scene file names only the instances. To change a prefab, Unpack an instance (its copy becomes editable nodes again, at the same place), edit, and Make prefab under the same name: the file is written over and every instance in the scene rebuilds from it. Both steps undo.

**Scripts** are TypeScript files in the project's `scripts/` folder, each exporting a class that extends the engine's `Script`. The inspector lists the scripts on the selected node with their exposed fields, attaches one from the project's files, writes a new one from a template (named after its class) and attaches it, and detaches. The editor compiles scripts in the browser: a file is read from the project folder, stripped of its types with sucrase, its imports of `@nickpaustian/catalyst` (and its entry points) and `three` pointed at the editor's own copies and its relative imports at the project's other files, and loaded as a module. A file that fails to build stays named on the node, marked not built, with the reason in the console. Scripts are held while editing and run in the runner; View → Scripts running starts them in the editor, and Reload scripts rebuilds every script from its file after an edit, keeping the values. Scenes save scripts beside their nodes, so the runner and a built player get the same behaviour.

Scripts are viewed and edited in the **Code** pane: Edit on a script in the inspector (or choosing a file in the pane's own list) opens the file in a CodeMirror editor with TypeScript highlighting, below the viewport if the pane was closed. Save (⌘S in the editor) writes the file and rebuilds every script in the scene; a build error is shown in the pane's status against the file, and the scripts from that file stay on their nodes as "not built" until the next good save.

## The start screen

Until a project is open the editor shows a start screen over the viewport: New project (a name, for a project in the browser's storage; a folder picked or made in the system picker, in the desktop app), Open folder…, and the recent list. Recent is the projects the browser keeps plus the last folder picked on disk, or, in the desktop app, the last twelve folders opened by path; × takes one off the list, and a folder that has gone is dropped when it is clicked. New project opens a dialog for the project's name, its location (in the desktop app: a parent folder, under which a folder named after the project is made), its recipe and a description, written to `<name>.catalyst` in the folder (a `project.json` from before is still read), with a checkbox in the desktop app to start a git repository there (`git init` through the git on the PATH, plus a `.gitignore` for `node_modules` and `.DS_Store`); File → Project settings… opens the same dialog on an open project to change the name and description, and the project's name is what the menu bar and the recent list show. The desktop app registers the `.catalyst` extension, so opening a project file from the Finder launches Catalyst with that project, and one dropped on a running app opens there. File → Close project puts the start screen back. In the desktop app the start screen is a small window of its own (`start.html`), the editor window hidden until a project is chosen there and hidden again on Close project; closing the start window with nothing open quits.

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

Four panes: the scene tree on the left, the viewport, the inspector on the right with the selected node's fields, the environment and any recipe sections, and the code pane, closed until a script is opened. Drag a gutter to resize, a pane's title to move it (a pane moved to the other side keeps its width, the others taking back the room they gained; stacked above or below another it takes that pane's width and half its height); + adds a closed pane back, × closes one; View → Reset pane layout restores the default.

Orbit: drag to orbit, right-drag to pan, wheel to zoom. F focuses the selected node, Delete removes it, the gizmo moves or rotates it (View menu). Snapping is on by default, a quarter unit and 15°, with the steps in the View menu; holding Shift during a drag gives the opposite of the setting, and the setting is remembered per browser. Add node (⌘⇧A) opens a dialog with the kinds laid out as their class hierarchy, like Godot's: search, arrow keys and Enter, a recent list, a description for each, double-click to create; base classes that are not kinds show greyed as groups. Shift-click in the tree selects a range, ctrl- or cmd-click toggles one, and a dragged row drops before, after or inside another with its world transform kept. Fields come from each node class's exposed properties; number fields scrub sideways. Every change can be undone and redone (Edit menu, ⌘Z and ⌘⇧Z): a gizmo drag is one step, a scrub is one step, and the project counts as clean again when undo reaches the saved state. Physics is held still while editing (View → Physics running lets it go).
