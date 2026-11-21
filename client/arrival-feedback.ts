import { PRACTICE_PULSE_MS } from '../shared/arrival.ts'
import type { PlayerId, PracticeReceipt, State } from '../shared/protocol.ts'

export type PracticeFeedback = {
  lobbyId?: string
  pulses: Record<PlayerId, { seq: number; receivedAt: number }>
}

export function practiceLobbyId(state: State | null | undefined): string | undefined {
  return state?.arrival?.kind === 'lobby' ? state.arrival.id : undefined
}

export function emptyPractice(lobbyId?: string): PracticeFeedback {
  return lobbyId === undefined ? { pulses: {} } : { lobbyId, pulses: {} }
}

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
