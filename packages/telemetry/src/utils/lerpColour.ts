export const lerpColour = (
  colourA: { r: number; g: number; b: number },
  colourB: { r: number; g: number; b: number },
  t: number
): string => {
  const r = Math.round(colourA.r + (colourB.r - colourA.r) * t)
  const g = Math.round(colourA.g + (colourB.g - colourA.g) * t)
  const b = Math.round(colourA.b + (colourB.b - colourA.b) * t)

  return `rgb(${r}, ${g}, ${b})`
}
