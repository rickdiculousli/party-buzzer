export function aimFromDrag(dx: number, dy: number) {
  return {
    angle: Math.max(-1, Math.min(1, dx / 140)),
    tension: Math.max(0, Math.min(1, Math.hypot(dx, Math.max(0, dy)) / 220)),
  }
}

type SequenceStorage = Pick<Storage, 'getItem' | 'setItem'>

export function nextBowSequence(storage: SequenceStorage): number {
  const previous = Number(storage.getItem('bowInputSeq'))
  const next = Number.isSafeInteger(previous) && previous >= 0 ? previous + 1 : 1
  storage.setItem('bowInputSeq', String(next))
  return next
}

export function canBowShoot(
  phase: string,
  endsAt: number | undefined,
  now: number,
  participant: boolean,
  reloading: boolean,
): boolean {
  return phase === 'playing' && participant && !reloading && now < (endsAt ?? 0)
}
