import type { Input } from "@nickpaustian/catalyst/input"

export interface EditorInputHandlers {
  focusSelected: () => void
  deleteSelected: () => void
  moveTool: () => void
  rotateTool: () => void
  scaleTool: () => void
  boxTool: () => void
  colliderTool: () => void
  vertexTool: () => void
  vertexMode: () => void
  edgeMode: () => void
  faceMode: () => void
  extrude: () => void
  paintTool: () => void
}

/** The editor's own key bindings on the engine's Helm, on while orbiting. */
export class EditorInput {
  private static readonly BINDINGS: Record<keyof EditorInputHandlers, string[]> = {
    focusSelected: ["f"],
    deleteSelected: ["delete", "backspace"],
    moveTool: ["w"],
    rotateTool: ["e"],
    scaleTool: ["r"],
    boxTool: ["b"],
    colliderTool: ["v"],
    vertexTool: ["Tab"],
    vertexMode: ["1"],
    edgeMode: ["2"],
    faceMode: ["3"],
    extrude: ["x"],
    paintTool: ["p"],
  }

  private active = false
  private unsubscribe: (() => void) | null = null
  private readonly input: Input
  private readonly handlers: EditorInputHandlers

  constructor(input: Input, handlers: EditorInputHandlers) {
    this.input = input
    this.handlers = handlers
  }

  activate(): void {
    if (this.active) return
    for (const [action, keys] of Object.entries(EditorInput.BINDINGS)) this.input.bind(action, keys)
    this.unsubscribe = this.input.signals.onActionEnd.subscribe(({ action }) => {
      const handler = this.handlers[action as keyof EditorInputHandlers]
      handler?.()
    })
    this.active = true
  }

  deactivate(): void {
    if (!this.active) return
    this.unsubscribe?.()
    this.unsubscribe = null
    for (const action of Object.keys(EditorInput.BINDINGS)) this.input.helm.unbind(action)
    this.active = false
  }
}
