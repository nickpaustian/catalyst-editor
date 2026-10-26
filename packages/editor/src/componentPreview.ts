import { createLightspeedApp, type LightspeedRuntime } from "@lightspeed-js/core"
import { compileComponent } from "./ui/Component"

type MountHandle = NonNullable<Awaited<ReturnType<LightspeedRuntime["mount"]>>>

/** A cell a component reads or writes, and a prop it declares with its default. */
export interface ComponentInputs {
  cells: string[]
  props: Record<string, unknown>
}

/** The cells a component's source names: `shared('name', …)` in its logic and `shared['name']` in its markup. */
export const cellsOf = (source: string): string[] => {
  const names = new Set<string>()
  for (const match of source.matchAll(/shared\(\s*(['"`])([^'"`]+)\1/g)) names.add(match[2])
  for (const match of source.matchAll(/shared\[\s*(['"`])([^'"`]+)\1\s*\]/g)) names.add(match[2])
  return [...names]
}

/** The props a component declares, `defineProps({ title: { default: 'Hello' } })`, with their defaults; a default that cannot be read is undefined. */
export const propsOf = (source: string): Record<string, unknown> => {
  const declared = /defineProps\s*(?:<[^>]*>)?\s*\(\s*\{([\s\S]*?)\}\s*\)/.exec(source)
  if (!declared) return {}
  const props: Record<string, unknown> = {}
  for (const match of declared[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{([^{}]*)\}/g)) {
    const value = /default\s*:\s*([\s\S]+?)\s*(?:,\s*\w+\s*:|$)/.exec(match[2])?.[1]
    let initial: unknown = undefined
    try {
      // The component's own code, which it runs as soon as it mounts anyway.
      if (value !== undefined) initial = new Function(`return (${value})`)()
    } catch {
      initial = undefined
    }
    props[match[1]] = initial
  }
  return props
}

/**
 * A component shown on its own for the preview pane: compiled from text (the
 * code pane's draft, so it follows the typing), mounted in a runtime of its
 * own so its cells meet neither the editor's nor the scene's, inside a shadow
 * root shaped like a slate's so a slate stylesheet styles it as it would in
 * the scene. Its cells keep their values across a remount.
 */
export class ComponentPreview {
  /** The element the preview draws in. */
  readonly host: HTMLElement
  readonly runtime: LightspeedRuntime = createLightspeedApp()
  private readonly sheet = document.createElement("style")
  private readonly own = document.createElement("style")
  private readonly mountPoint = document.createElement("div")
  private handle: MountHandle | null = null
  private generation = 0

  constructor(host: HTMLElement) {
    this.host = host
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" })
    const slate = document.createElement("div")
    slate.className = "slate"
    const element = document.createElement("div")
    element.className = "ui-component"
    element.dataset.node = "preview"
    this.mountPoint.style.display = "contents"
    element.appendChild(this.mountPoint)
    slate.appendChild(element)
    const base = document.createElement("style")
    // A slate fills its viewport and a component its slate, as an anchor of fill places them.
    base.textContent = ":host{display:block;position:relative;overflow:hidden}.slate{position:absolute;inset:0}.ui-component{position:absolute;inset:0}"
    root.replaceChildren(base, this.sheet, this.own, slate)
  }

  /** Compile and mount `source` with `props`, styled by `stylesheet`; gives back why it did not show, or null. */
  async show(source: string, stylesheet: string, props: Record<string, unknown>): Promise<string | null> {
    const generation = ++this.generation
    this.sheet.textContent = stylesheet
    try {
      const { id, definition, css } = await compileComponent(source)
      if (generation !== this.generation) return null
      this.unmount()
      this.own.textContent = css
      this.runtime.useComponents({ [id]: async () => definition })
      const mount = await this.runtime.mount(id, this.mountPoint, props)
      if (generation !== this.generation) {
        if (mount) this.runtime.unmount(mount)
        return null
      }
      if (!mount) return "it did not mount"
      this.handle = mount
      return null
    } catch (error) {
      if (generation !== this.generation) return null
      return error instanceof Error ? error.message : String(error)
    }
  }

  /** A stylesheet changed alone: no remount needed. */
  restyle(stylesheet: string): void {
    this.sheet.textContent = stylesheet
  }

  cell(name: string) {
    return this.runtime.shared(name)
  }

  dispose(): void {
    this.generation++
    this.unmount()
  }

  private unmount(): void {
    if (this.handle) this.runtime.unmount(this.handle)
    this.handle = null
    this.mountPoint.replaceChildren()
  }
}
