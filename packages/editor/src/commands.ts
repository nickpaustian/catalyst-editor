/**
 * The one way the panel talks to the editor: a command dropped into a shared
 * cell, which the EditorSession subscribes to. Each send is a new object, so
 * the same command twice in a row still arrives twice.
 */
let seq = 0

export const sendCommand = (command: Record<string, unknown>): void => {
  ;(window as any).lightspeed?.shared("editor:command").set({ ...command, seq: ++seq })
}
