import { useEffect, useState } from 'preact/hooks'
import { activePracticePlayers, type PracticeFeedback } from './arrival-feedback.ts'

/**
 * Local monotonic time for reading practice pulses. One surface-level tick, at
 * 50 ms and only while a pulse is still lit, so expiry needs no timeout per
 * press. `frozenNow` is a review fixture's clock: returned as is, never ticking.
 */
export function usePracticeTime(feedback: PracticeFeedback, lobbyId?: string, frozenNow?: number): number {
  const now = frozenNow ?? performance.now()
  return useLitTime(activePracticePlayers(feedback, lobbyId, now).length > 0, frozenNow)
}

/** The same clock for anything lit by a receipt: ticks at 50 ms while `lit`, frozen for a fixture. */
export function useLitTime(lit: boolean, frozenNow?: number): number {
  const [, tick] = useState(0)
  const live = frozenNow === undefined && lit
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => tick((n) => n + 1), 50)
    return () => clearInterval(id)
  }, [live])
  return frozenNow ?? performance.now()
}
