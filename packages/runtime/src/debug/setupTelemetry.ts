import Telemetry, { Cartesian, Histogram, bindFps } from "@vitrine/telemetry"

const setupTelemetry = (): Telemetry => {
  const telemetry = new Telemetry()

  const histogram = new Histogram("fps-graph", {
    label: "FPS",
    width: 75,
    height: 75,
    historyLength: 200,
    showAverage: false,
    value: 0,
  })
  telemetry.registerWidget(histogram)

  bindFps(telemetry, "fps-graph")

  const forceInput = new Cartesian("force-input", {
    label: "Force Input",
    maxValue: 1,
    x: 0,
    y: 0,
  })
  telemetry.registerWidget(forceInput)

  telemetry.data["force-input"].x = 0.73
  telemetry.data["force-input"].y = 0.6

  return telemetry
}

export default setupTelemetry
