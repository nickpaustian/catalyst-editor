export const nextTick = (cb: () => void): void => {
  setTimeout(() => {
    queueMicrotask(cb)
  }, 10)
}
