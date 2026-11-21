export type RawBuzz = {
  playerId: string
  at: number
  arrivedAt: number
}

export type Resolved = {
  playerId: string
  at: number
  deltaMs: number
}

export function resolveBuzzes(
  buzzes: RawBuzz[],
  armedAt: number,
  excluded: string[],
): Resolved[] {
  const barred = new Set(excluded)
  const earliest = new Map<string, Resolved>()

  for (const b of buzzes) {
    if (barred.has(b.playerId)) continue
    const at = Math.min(Math.max(b.at, armedAt), b.arrivedAt)
    const prev = earliest.get(b.playerId)
    if (!prev || at < prev.at) {
      earliest.set(b.playerId, { playerId: b.playerId, at, deltaMs: 0 })
    }
  }

  const arrival = new Map(buzzes.map((b) => [b.playerId, b.arrivedAt]))
  const sorted = [...earliest.values()].sort(
    (x, y) =>
      x.at - y.at ||
      arrival.get(x.playerId)! - arrival.get(y.playerId)! ||
      x.playerId.localeCompare(y.playerId),
  )

  const first = sorted[0]?.at ?? 0
  return sorted.map((b) => ({ ...b, deltaMs: Math.round(b.at - first) }))
}
