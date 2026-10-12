export const remapProgress = (
  raw: number,
  remapTable: Array<[number, number]>
): number => {
  const table = remapTable
  for (let i = 0; i < table.length - 1; i++) {
    const [r0, d0] = table[i]
    const [r1, d1] = table[i + 1]
    if (raw <= r1) {
      const t = (raw - r0) / (r1 - r0)
      return d0 + t * (d1 - d0)
    }
  }
  return table[table.length - 1][1]
}
