/**
 * A waveform reduced to what a column of pixels can show.
 *
 * One min/max pair per column, which is how every editor draws audio: a column
 * is a vertical line from the quietest sample under it to the loudest, so a
 * click a hundred samples wide still reaches full height at any zoom.
 *
 * Pure, so the drawing can be checked without a browser or a decoder.
 *
 * ponytail: reduced at the draw width, recomputed on resize. No cached
 * multi-resolution pyramid — these files are seconds long, not hours. Build one
 * if a cue ever holds a full song.
 */
export type Peak = { min: number; max: number }

export function peaks(data: Float32Array, width: number): Peak[] {
  const n = Math.max(1, Math.floor(width))
  const out: Peak[] = []
  for (let c = 0; c < n; c++) {
    const from = Math.floor((c * data.length) / n)
    // At least one sample per column even when the file is shorter than the
    // panel is wide, so a column never comes back as the empty -Infinity pair.
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
