import { useEffect, useState } from 'preact/hooks'
import { activePracticePlayers, type PracticeFeedback } from './arrival-feedback.ts'

/**
 * Local monotonic time for reading practice pulses. One surface-level tick, at
 * 50 ms and only while a pulse is still lit, so expiry needs no timeout per
 * press. `frozenNow` is a review fixture's clock: returned as is, never ticking.
 */
export function usePracticeTime(feedback: PracticeFeedback, lobbyId?: string, frozenNow?: number): number {
  const [, tick] = useState(0)
  const now = frozenNow ?? performance.now()
  const live = frozenNow === undefined && activePracticePlayers(feedback, lobbyId, now).length > 0
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => tick((n) => n + 1), 50)
    return () => clearInterval(id)
  }, [live])
  return now
}
