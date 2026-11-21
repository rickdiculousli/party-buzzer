export type Peak = { min: number; max: number }

export function peaks(data: Float32Array, width: number): Peak[] {
  const n = Math.max(1, Math.floor(width))
  const out: Peak[] = []
  for (let c = 0; c < n; c++) {
    const from = Math.floor((c * data.length) / n)
    const to = Math.min(data.length, Math.max(from + 1, Math.floor(((c + 1) * data.length) / n)))
    let min = 0
    let max = 0
    for (let i = from; i < to; i++) {
      const v = data[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    out.push({ min, max })
  }
  return out
}
