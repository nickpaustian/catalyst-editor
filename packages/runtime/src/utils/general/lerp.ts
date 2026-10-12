export const lerp = (start: number, end: number, amount: number): number => {
  return start + (end - start) * amount
}
