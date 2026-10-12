export function formatTime(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }

  if (ms < 60 * 1000) {
    const seconds = (ms / 1000).toFixed(3)
    return `${seconds}s`
  }

  if (ms < 60 * 60 * 1000) {
    const minutes = Math.floor(ms / (60 * 1000))
    const seconds = Math.floor((ms % (60 * 1000)) / 1000)
    return `${minutes}m ${seconds}s`
  }

  if (ms < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(ms / (60 * 60 * 1000))
    const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
    const seconds = Math.floor((ms % (60 * 1000)) / 1000)
    return `${hours}h ${minutes}m ${seconds}s`
  }

  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000))
  const seconds = Math.floor((ms % (60 * 1000)) / 1000)
  return `${days}d ${hours}h ${minutes}m ${seconds}s`
}
