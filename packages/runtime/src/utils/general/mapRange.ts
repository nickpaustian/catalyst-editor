import { Easing } from "../../constants"
import { clamp } from "@vitrine/catalyst"

export const mapRange: (
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  useClamp?: boolean,
  easingFunction?: (t: number) => number
) => number = (
  value,
  inMin,
  inMax,
  outMin,
  outMax,
  useClamp = true,
  easingFunction = Easing.linear
) => {
  if (useClamp) clamp(value, inMax, inMax)

  let normalisedValue = (value - inMin) / (inMax - inMin)

  normalisedValue = easingFunction(normalisedValue)

  return outMin + normalisedValue * (outMax - outMin)
}
