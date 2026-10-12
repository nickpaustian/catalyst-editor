import * as THREE from "three"
import { Collider, Node3D } from "@vitrine/catalyst"
import { assets, type Exhibition } from "@vitrine/runtime"
import type { JsonAsset } from "@vitrine/assets"

interface CatalogueEntry {
  id: string
  title: string
  manifest: string
}

type SceneKey = "colliders" | "focalPoints" | "focalPointTriggers" | "pointsOfInterest"

const SCENE_KEYS: SceneKey[] = [
  "colliders",
  "focalPoints",
  "focalPointTriggers",
  "pointsOfInterest",
]

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  Object.assign(node, props)
  children.forEach((child) => node.append(child))
  return node
}

const download = (name: string, text: string) => {
  const blob = new Blob([text], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const a = el("a", { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

const round = (n: number, places = 4) => Number(n.toFixed(places))

/**
 * First editor slice: the runtime with visualisers on, a list of the scene
 * nodes, transform fields for the selected one, and export that patches the
 * loaded scene files with the live transforms.
 */
export class EditorPanel {
  private root: HTMLElement
  private selected: Node3D | null = null
  private fields: Record<string, HTMLInputElement> = {}
  private lists: Partial<Record<SceneKey, HTMLElement>> = {}
  private selectionLabel: HTMLElement
  private visualised = false
  private lastMoveNode: Node3D | null = null

  private exhibition: Exhibition

  constructor(
    exhibition: Exhibition,
    catalogue: CatalogueEntry[],
    onSwitch: (id: string) => void
  ) {
    this.exhibition = exhibition
    this.root = el("div", { id: "editor-panel" })
    document.body.classList.add("editor-panel-open")

    const select = el("select")
    catalogue.forEach((entry) => {
      select.append(
        el("option", {
          value: entry.id,
          textContent: entry.title,
          selected: entry.id === exhibition.manifest.id,
        })
      )
    })
    select.addEventListener("change", () => onSwitch(select.value))

    this.root.append(
      el("h1", { textContent: "Vitrine" }),
      el("div", { className: "row" }, [select]),
      el("h2", { textContent: "View" }),
      el("div", {}, [
        this.button("Visualisers", () => this.toggleVisualisers()),
        this.button("Guided / first person", () =>
          exhibition.managers.scene.toggleCamera()
        ),
        this.button("Move mode (o)", () => this.toggleMoveMode()),
      ]),
      el("p", {
        className: "hint",
        textContent:
          "First person: WASD, click to look. Move mode: look at a node and press F to pick it up, F again to drop.",
      })
    )

    SCENE_KEYS.forEach((key) => {
      const list = el("div", { className: "node-list" })
      this.lists[key] = list
      this.root.append(el("h2", { textContent: key }), list)
    })

    this.selectionLabel = el("div", { className: "row hint", textContent: "Nothing selected" })
    this.root.append(el("h2", { textContent: "Selected" }), this.selectionLabel)
    this.root.append(this.transformFields())

    this.root.append(
      el("h2", { textContent: "Export" }),
      el("div", {}, [
        this.button("Scene files", () => this.exportSceneFiles()),
        this.button("Manifest", () => this.exportManifest()),
      ]),
      el("p", {
        className: "hint",
        textContent:
          "Scene files are the loaded JSON with live transforms written back by node name.",
      })
    )

    document.body.append(this.root)
    const state = exhibition.managers.state
    state.pauseOnPointerUnlock = false
    state.lockPointerFilter = (target) =>
      !(target instanceof Node && this.root.contains(target))
    void exhibition.ready.then(() => {
      this.refreshLists()
      this.toggleVisualisers()
    })
    setInterval(() => this.pollMoveNode(), 250)
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const button = el("button", { textContent: label })
    button.addEventListener("click", onClick)
    return button
  }

  private get scene() {
    return this.exhibition.managers.scene
  }

  private toggleVisualisers(): void {
    this.visualised = !this.visualised
    this.scene.visualiseScene(this.visualised)
  }

  private toggleMoveMode(): void {
    const controller = this.scene.controller
    if (!controller) return
    controller.toggleDebugMode()
    this.exhibition.managers.ui.setInteractionLabel(
      controller.debugMode ? "move" : "View"
    )
  }

  private refreshLists(): void {
    const roots = this.scene.sceneRoots
    SCENE_KEYS.forEach((key) => {
      const list = this.lists[key]!
      list.innerHTML = ""
      roots[key]?.getChildren().forEach((node) => {
        if (!(node instanceof Node3D)) return
        const item = el("div", { textContent: node.name })
        item.addEventListener("click", () => this.select(node, key))
        if (node === this.selected) item.classList.add("selected")
        list.append(item)
      })
    })
  }

  private select(node: Node3D | null, _key: SceneKey | null): void {
    this.selected = node
    this.selectionLabel.textContent = node
      ? `${node.constructor.name} ${node.name}`
      : "Nothing selected"
    this.refreshLists()
    this.readTransform()
  }

  private transformFields(): HTMLElement {
    const wrap = el("div")
    const row = (label: string, keys: string[]) => {
      const r = el("div", { className: "row" }, [el("span", { className: "hint", textContent: label + " " })])
      keys.forEach((k) => {
        const input = el("input", { type: "number", step: "0.01" })
        input.addEventListener("change", () => this.writeTransform())
        this.fields[k] = input
        r.append(el("label", { textContent: k.slice(-1) }), input)
      })
      return r
    }
    wrap.append(row("pos", ["px", "py", "pz"]), row("rot°", ["rx", "ry", "rz"]))
    return wrap
  }

  private readTransform(): void {
    const node = this.selected
    if (!node) {
      Object.values(this.fields).forEach((f) => (f.value = ""))
      return
    }
    const p = node.transform.position
    const e = new THREE.Euler().setFromQuaternion(node.transform.rotation, "YXZ")
    this.fields.px.value = String(round(p.x))
    this.fields.py.value = String(round(p.y))
    this.fields.pz.value = String(round(p.z))
    this.fields.rx.value = String(round(THREE.MathUtils.radToDeg(e.x), 2))
    this.fields.ry.value = String(round(THREE.MathUtils.radToDeg(e.y), 2))
    this.fields.rz.value = String(round(THREE.MathUtils.radToDeg(e.z), 2))
  }

  private writeTransform(): void {
    const node = this.selected
    if (!node) return
    const f = this.fields
    node.transform.position = new THREE.Vector3(
      Number(f.px.value),
      Number(f.py.value),
      Number(f.pz.value)
    )
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(Number(f.rx.value)),
      THREE.MathUtils.degToRad(Number(f.ry.value)),
      THREE.MathUtils.degToRad(Number(f.rz.value)),
      "YXZ"
    )
    node.transform.rotation = new THREE.Quaternion().setFromEuler(euler)
    if (node instanceof Collider) node.needsUpdate()
  }

  /** Follow the move mode: picking a node up selects it, dropping it refreshes the fields. */
  private pollMoveNode(): void {
    const moving = this.exhibition.managers.state.moveNode
    if (moving === this.lastMoveNode) return
    this.lastMoveNode = moving as Node3D | null
    if (moving instanceof Node3D) {
      const key = SCENE_KEYS.find((k) =>
        this.scene.sceneRoots[k]?.getChildren().includes(moving)
      )
      this.select(moving, key ?? null)
    } else {
      this.readTransform()
    }
  }

  private patchedSceneJson(key: SceneKey): unknown | null {
    const asset = this.exhibition.managers.exhibitionAssets.scene[key] as
      | JsonAsset<any>
      | undefined
    const root = this.scene.sceneRoots[key]
    if (!asset?.isReady || !root) return null

    const json = structuredClone(asset.json)
    for (const entry of json.children ?? []) {
      const name = entry.config?.name ?? entry.name
      const node = root.getNode<Node3D>(name)
      if (!node) continue
      const p = node.transform.position
      const q = node.transform.rotation
      entry.transform = {
        ...entry.transform,
        position: [round(p.x), round(p.y), round(p.z)],
        rotation: [round(q.x), round(q.y), round(q.z), round(q.w)],
      }
    }
    return json
  }

  private exportSceneFiles(): void {
    const manifest = this.exhibition.manifest
    SCENE_KEYS.forEach((key) => {
      const json = this.patchedSceneJson(key)
      const url = manifest.scene[key]
      if (!json || !url) return
      const name = url.split("/").pop() ?? `${key}.json`
      download(name, JSON.stringify(json, null, 2))
    })
  }

  private exportManifest(): void {
    const raw = assets.getAs<JsonAsset>(this.exhibition.manifest.url)
    if (!raw?.isReady) return
    download("manifest.json", JSON.stringify(raw.json, null, 2))
  }
}
