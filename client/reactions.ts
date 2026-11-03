/**
 * Reactions as the board sees them: receipts stamped with local monotonic
 * receipt time, and the pills the wall shows from them. Pure, so the cap and
 * expiry are testable with injected times; `useSocket` feeds it and the
 * board's tick reads it.
 */
import type { PlayerId, QuizReactKind, ReactionReceipt } from '../shared/protocol.ts'

/** `col` is decided on receipt: the pill's column, or none for one of the "+N" that only count. */
export type TimedReaction = ReactionReceipt & { receivedAt: number; col?: number }

/** How long a receipt is up: the rise, hold and fade of `.board__pill` in style.css sum to this. */
export const PILL_MS = 2400
/** The fade at the end of that, `--pill-fade-dur` in style.css; the count chip fades with the newest pill. */
export const PILL_FADE_MS = 600
/** The most pills up at once, one column each; past it a receipt only counts in the "+N" chip. A board constant. */
export const PILL_CAP = 6
/** How far each column's pill rises, as a share of the tuned height: one per column, none equal, so a batch never lines up. */
export const LIFTS = [1, 0.78, 0.92, 0.7, 0.86, 0.62]

/**
 * Keep a receipt for the current question in the lowest free column; drop the
 * expired and anything from an old question. A receipt arriving with every
 * column taken never gets one: a pill promoted later would be cut mid-rise by
 * its own clock, so it only counts.
 */
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

/**
 * The pills up at `now` for `questionId`, oldest first, and how many more only
 * count in the chip. The count ends with the last pill: a chip alone over an
 * empty band would count nothing the room can see.
 */
export function shownPills(
  list: TimedReaction[],
  questionId: string | undefined,
  now: number,
): { pills: Pill[]; more: number } {
  const live = questionId === undefined ? [] : freshReactions(list, now).filter((r) => r.questionId === questionId)
  const pills = live.flatMap((r) => (r.col === undefined ? [] : [{ seq: r.seq, playerId: r.playerId, kind: r.kind, col: r.col, at: r.receivedAt }]))
  return { pills, more: pills.length ? live.length - pills.length : 0 }
}
