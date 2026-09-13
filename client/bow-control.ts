/** Degrees clockwise from straight up; the 65° span matches `launchBow` on the server. */
export const aimDegrees = (angle: number) => angle * 65

/** The shot points opposite the drag vector; its length sets tension. */
export function aimFromDrag(dx: number, dy: number) {
  const down = Math.max(0, dy)
  return {
    angle: Math.max(-1, Math.min(1, -Math.atan2(dx, down) * 180 / Math.PI / 65)),
    tension: Math.max(0, Math.min(1, Math.hypot(dx, down) / 220)),
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
