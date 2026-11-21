import { useEffect, useState } from 'preact/hooks'
import { activePracticePlayers, type PracticeFeedback } from './arrival-feedback.ts'

export function usePracticeTime(feedback: PracticeFeedback, lobbyId?: string, frozenNow?: number): number {
  const now = frozenNow ?? performance.now()
  return useLitTime(activePracticePlayers(feedback, lobbyId, now).length > 0, frozenNow)
}

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
