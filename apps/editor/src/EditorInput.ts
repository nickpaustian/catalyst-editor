import { Catalyst } from "@vitrine/catalyst"

export interface EditorInputHandlers {
  focusSelected: () => void
}

/**
 * Helm bindings for orbit mode. Beruk binds F to "interact" in first person,
 * and Helm fires every action bound to a pressed key, so the visitor binding
 * is parked while the editor's is active and restored on the way out.
 */
export class EditorInput {
  private static readonly BINDINGS: Record<string, string> = {
    focusSelected: "f",
  }
  private static readonly PARKED: Record<string, string> = {
    interact: "f",
  }

  private active = false
  private unsubscribe: (() => void) | null = null

  private readonly handlers: EditorInputHandlers

  constructor(handlers: EditorInputHandlers) {
    this.handlers = handlers
  }

  public activate(): void {
    if (this.active) return
    const input = Catalyst._.input
    if (!input) return

    Object.keys(EditorInput.PARKED).forEach((action) => input.unbind(action))
    Object.entries(EditorInput.BINDINGS).forEach(([action, key]) =>
      input.bind(action, key)
    )
    this.unsubscribe = input.signals.onActionEnd.subscribe(({ action }) => {
      if (action === "focusSelected") this.handlers.focusSelected()
    })
    this.active = true
  }

  public deactivate(): void {
    if (!this.active) return
    const input = Catalyst._.input
    if (!input) return

    this.unsubscribe?.()
    this.unsubscribe = null
    Object.keys(EditorInput.BINDINGS).forEach((action) => input.unbind(action))
    Object.entries(EditorInput.PARKED).forEach(([action, key]) =>
      input.bind(action, key)
    )
    this.active = false
  }
}
