import type { PlayerId, QuizReactKind, ReactionReceipt } from '../shared/protocol.ts'

export type TimedReaction = ReactionReceipt & { receivedAt: number; col?: number }

export const PILL_MS = 2400
export const PILL_FADE_MS = 600
export const PILL_CAP = 6
export const LIFTS = [1, 0.78, 0.92, 0.7, 0.86, 0.62]

export function recordReaction(
  list: TimedReaction[],
  receipt: ReactionReceipt,
  questionId: string | undefined,
  receivedAt: number,
  cap = PILL_CAP,
): TimedReaction[] {
  if (questionId === undefined || receipt.questionId !== questionId) return list
  const fresh = freshReactions(list, receivedAt)
  const held = new Set(fresh.filter((r) => r.questionId === questionId).map((r) => r.col))
  const col = Array.from({ length: cap }, (_, i) => i).find((i) => !held.has(i))
  return [...fresh, { ...receipt, receivedAt, ...(col !== undefined && { col }) }]
}

export const freshReactions = (list: TimedReaction[], now: number) => list.filter((r) => now - r.receivedAt < PILL_MS)

export type Pill = { seq: number; playerId: PlayerId; kind: QuizReactKind; col: number; at: number }

export function shownPills(
  list: TimedReaction[],
  questionId: string | undefined,
  now: number,
): { pills: Pill[]; more: number } {
  const live = questionId === undefined ? [] : freshReactions(list, now).filter((r) => r.questionId === questionId)
  const pills = live.flatMap((r) => (r.col === undefined ? [] : [{ seq: r.seq, playerId: r.playerId, kind: r.kind, col: r.col, at: r.receivedAt }]))
  return { pills, more: pills.length ? live.length - pills.length : 0 }
}
