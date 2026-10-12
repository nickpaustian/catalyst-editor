import type { Padding, PaddingConfig } from "../types"

export const resolvePadding = (padding?: Padding): Required<PaddingConfig> => {
  if (padding === undefined) return { top: 0, right: 0, bottom: 0, left: 0 }
  if (typeof padding === "number")
    return { top: padding, right: padding, bottom: padding, left: padding }
  return {
    top: padding.top ?? 0,
    right: padding.right ?? 0,
    bottom: padding.bottom ?? 0,
    left: padding.left ?? 0,
  }
}
