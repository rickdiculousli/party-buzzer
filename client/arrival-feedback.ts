/**
 * Practice pulses as the browser sees them: the latest receipt per player,
 * stamped with local monotonic receipt time. Pure, so expiry and staleness are
 * testable with injected times; `useSocket` feeds it and one surface tick reads it.
 */
import { PRACTICE_PULSE_MS } from '../shared/arrival.ts'
import type { PlayerId, PracticeReceipt } from '../shared/protocol.ts'

export type PracticeFeedback = {
  lobbyId?: string
  pulses: Record<PlayerId, { seq: number; receivedAt: number }>
}

export function emptyPractice(lobbyId?: string): PracticeFeedback {
  return lobbyId === undefined ? { pulses: {} } : { lobbyId, pulses: {} }
}

/** Keep a receipt for the current lobby that is newer than that player's last one. */
export function recordPractice(
  feedback: PracticeFeedback,
  receipt: PracticeReceipt,
  lobbyId: string | undefined,
  receivedAt: number,
): PracticeFeedback {
  if (lobbyId === undefined || receipt.lobbyId !== lobbyId) return feedback
  const base = feedback.lobbyId === lobbyId ? feedback : emptyPractice(lobbyId)
  const prev = base.pulses[receipt.playerId]
  if (prev && prev.seq >= receipt.seq) return feedback
  return { lobbyId, pulses: { ...base.pulses, [receipt.playerId]: { seq: receipt.seq, receivedAt } } }
}

/** Scope feedback to the current lobby and roster. Unchanged feedback keeps its identity. */
export function prunePractice(
  feedback: PracticeFeedback,
  lobbyId: string | undefined,
  playerIds: readonly PlayerId[],
): PracticeFeedback {
  if (feedback.lobbyId !== lobbyId) return emptyPractice(lobbyId)
  const ids = Object.keys(feedback.pulses)
  const kept = ids.filter((id) => playerIds.includes(id))
  if (kept.length === ids.length) return feedback
  return { ...feedback, pulses: Object.fromEntries(kept.map((id) => [id, feedback.pulses[id]])) }
}

/** Players whose pulse is still lit at local time `now`. */
export function activePracticePlayers(
  feedback: PracticeFeedback,
  lobbyId: string | undefined,
  now: number,
): PlayerId[] {
  if (lobbyId === undefined || feedback.lobbyId !== lobbyId) return []
  return Object.entries(feedback.pulses)
    .filter(([, p]) => now - p.receivedAt < PRACTICE_PULSE_MS)
    .map(([id]) => id)
}
