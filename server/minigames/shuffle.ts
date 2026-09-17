/** Fisher-Yates on a copy, so a seeded run replays the same order. */
export function shuffle<T>(rand: () => number, items: T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
