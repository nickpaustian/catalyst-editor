import Telemetry from "../Telemetry"

export const bindFps = (
  telemetry: Telemetry,
  dataProperty: string = "fps",
  updateFrequency: number = 5
): void => {
  let frameCount = 0
  let lastTime = performance.now()

  const calculateFPS = () => {
    const currentTime = performance.now()
    const deltaTime = currentTime - lastTime

    frameCount++

    if (deltaTime >= updateFrequency) {
      const fps = Math.round((frameCount * 1000) / deltaTime)
      telemetry.data[dataProperty] = fps
      frameCount = 0
      lastTime = currentTime
    }

    requestAnimationFrame(calculateFPS)
  }

  requestAnimationFrame(calculateFPS)
}
