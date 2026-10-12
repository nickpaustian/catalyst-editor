import type { BezierCurve } from "@vitrine/catalyst"
import type { ProgressPoint, ProgressRange } from "./types"

/** Absolute path progress for a point, or null if its segment isn't on the rail. */
export const resolveProgressPoint = (
  rail: BezierCurve,
  point: ProgressPoint
): number | null => {
  if (typeof point === "number") return point
  const start = rail.getControlPointParameter(point.segment[0])
  const end = rail.getControlPointParameter(point.segment[1])
  if (start === null || end === null) return null
  return start + (end - start) * point.t
}

export const isWithinRange = (
  rail: BezierCurve,
  progress: number,
  range: ProgressRange
): boolean => {
  const from = range.from === undefined ? null : resolveProgressPoint(rail, range.from)
  const to = range.to === undefined ? null : resolveProgressPoint(rail, range.to)
  if (from !== null && progress < from) return false
  if (to !== null && progress > to) return false
  return true
}

export const isWithinAnyRange = (
  rail: BezierCurve,
  progress: number,
  ranges: ProgressRange[]
): boolean => ranges.some((range) => isWithinRange(rail, progress, range))
