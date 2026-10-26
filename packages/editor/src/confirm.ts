/** One button of a confirm dialog; the primary one is the default and also answers Enter. */
export interface ConfirmAction {
  label: string
  run: () => void
  primary?: boolean
}

export interface ConfirmState {
  title: string
  message: string
  actions: ConfirmAction[]
  /** Closed with Escape or a click outside, with no button chosen. */
  dismiss?: () => void
}

const CELL = "editor:confirm"

/** Put a question to the user with a few buttons. The ConfirmDialog component, mounted once per page, draws it; Escape closes it with no answer but `dismiss`. */
export const openConfirm = (title: string, message: string, actions: ConfirmAction[], dismiss?: () => void): void => {
  ;(window as any).lightspeed?.shared(CELL).set({ title, message, actions, dismiss } satisfies ConfirmState)
}

export const closeConfirm = (): void => {
  ;(window as any).lightspeed?.shared(CELL).set(null)
}

export const CONFIRM_CELL = CELL
