import type { SketchEnd, SketchShared } from '../shared/protocol.ts'
import type { Cue } from './sound.ts'

/** A board or phone frame, as far as cues and wording need one. */
export type SketchView = SketchShared & { matchId: string; tick: number; serverTime: number; close?: number }

/** A burst of wrong guesses plays as a patter, not a wall. */
export const MISS_GAP_MS = 120
/** The draw's last seconds tick. */
const TICK_FROM = 5
const PLACE_RATE = 0.06
const END_CUE: Record<SketchEnd, Cue> = { all: 'sketch-all', timeup: 'sketch-timeup', pass: 'sketch-pass' }

/** The lobby's one-line explanation, on the board and every phone. */
export const SKETCH_RULES = 'One player draws and everyone else types guesses. Faster guesses score more, and the drawer scores for everyone who gets it.'

export const secondsLeft = (endsAt: number, now: number) => Math.max(0, Math.ceil((endsAt - now) / 1000))
const hidden = (blanks: string) => blanks.split('_').length - 1
const newest = (list: { seq: number }[]) => Math.max(0, ...list.map((entry) => entry.seq))

/**
 * The cues one surface plays for the change from `prev` to `next`. `who` is
 * `'board'` or the phone's player id. A first frame, or one from another match,
 * only sets the baseline.
 */
export function sketchCues(prev: SketchView | null, next: SketchView, who: 'board' | string): { cue: Cue; rateScale?: number }[] {
  if (!prev || prev.matchId !== next.matchId) return []
  const board = who === 'board'
  const drawer = next.drawer === who
  // The countdown holds tick 0; the first turn starts with the first step.
  const turnStart = next.step === 'choosing' && (next.turn !== prev.turn || (prev.tick === 0 && next.tick > 0))
  const sameTurn = next.turn === prev.turn
  const out: { cue: Cue; rateScale?: number }[] = []

  if (turnStart && board) out.push({ cue: 'sketch-turn' })
  if (turnStart && drawer) out.push({ cue: 'sketch-yours' })
  if (!sameTurn) return out

  if (board && prev.step === 'choosing' && next.step === 'drawing') out.push({ cue: 'sketch-go' })
  if (board && newest(next.misses) > newest(prev.misses)) out.push({ cue: 'sketch-miss' })

  const top = newest(prev.correct)
  next.correct.forEach((entry, place) => {
    if (entry.seq <= top) return
    const rateScale = 1 + PLACE_RATE * place
    if (board || drawer) out.push({ cue: 'sketch-got', rateScale })
    else if (entry.player === who) out.push({ cue: 'sketch-right' })
  })

  if (!board && !drawer && (next.close ?? 0) > (prev.close ?? 0)) out.push({ cue: 'sketch-close' })
  if (!board) return out

  if (prev.step === 'drawing' && next.step === 'drawing') {
    if (prev.blanks && hidden(next.blanks) < hidden(prev.blanks)) out.push({ cue: 'sketch-hint' })
    const before = secondsLeft(prev.endsAt, prev.serverTime)
    const after = secondsLeft(next.endsAt, next.serverTime)
    if (after < before && after >= 1 && after <= TICK_FROM) out.push({ cue: 'sketch-tick' })
  }
  if (prev.step === 'drawing' && next.step === 'reveal' && next.end) out.push({ cue: END_CUE[next.end] })
  if (prev.step !== 'over' && next.step === 'over') out.push({ cue: 'sketch-over' })
  return out
}

export function stepLine(v: Pick<SketchShared, 'step' | 'drawer' | 'end'>, nameOf: (id: string) => string): string {
  switch (v.step) {
    case 'choosing': return `${nameOf(v.drawer)} is choosing a word`
    case 'drawing': return `${nameOf(v.drawer)} is drawing`
    case 'reveal': return v.end === 'pass' ? `${nameOf(v.drawer)} passed` : v.end === 'all' ? 'Everyone got it' : "Time's up"
    case 'over': return 'Match over'
  }
}

/** The reveal's stamp: how many got the word, or why nobody did. */
export function revealStamp(v: Pick<SketchShared, 'end' | 'correct'>): string {
  if (v.correct.length) return `${v.correct.length} got it`
  return v.end === 'pass' ? 'Passed' : 'Nobody'
}

/** One line of the board's chat: a wrong guess, or a right one (`text: null`). */
export type ChatLine = { seq: number; player: string; text: string | null; ms?: number }

/**
 * The chat as a deque. New lines go on the back; once there are more than
 * `max`, the oldest wrong guess comes off. Order never changes, so wrong
 * guesses leave from the slot just under the right ones, and a right guess
 * that reaches that slot stays: it is never the one taken. Only when every
 * line is a right guess does the oldest of them go.
 */
export function pushChat(lines: ChatLine[], incoming: ChatLine[], max: number): { lines: ChatLine[]; evicted: ChatLine[] } {
  const next = [...lines]
  const evicted: ChatLine[] = []
  for (const line of [...incoming].sort((a, b) => a.seq - b.seq)) {
    next.push(line)
    while (next.length > max) {
      const miss = next.findIndex((l) => l.text !== null)
      evicted.push(...next.splice(miss < 0 ? 0 : miss, 1))
    }
  }
  return { lines: next, evicted }
}

/**
 * The chat's slide. A line arriving mid-slide does not restart the clock: the
 * train finishes about when it was going to plus a quarter slide, never longer
 * than one, so a fast burst moves quicker and still settles on time.
 */
export const CHAT_SLIDE_MS = 260
const CHAT_SLIDE_MIN_MS = 90
export function chatSlideMs(now: number, endsAt: number): number {
  const left = Math.max(0, endsAt - now)
  return Math.round(Math.min(CHAT_SLIDE_MS, Math.max(CHAT_SLIDE_MIN_MS, left + CHAT_SLIDE_MS / 4)))
}

/** A chat line as the slide sees it: where it rested before this change, where it rests now, and how far off its rest it is drawn right now. */
export type ChatRow = { key: string; before?: number; now: number; carried: number; height: number }

/**
 * How far below its new rest each line starts its slide, in px. A line that
 * was already there starts from where it is drawn now, so a change mid-slide
 * carries on instead of jumping. New lines join the back of the train at the
 * offset of the line they follow, which already counts the slot they took;
 * with nothing to follow, they rise from just under the foot.
 */
export function chatStarts(rows: ChatRow[], gap: number): Map<string, number> {
  const last = rows.findLast((row) => row.before !== undefined)
  const entry = last
    ? last.before! + last.carried - last.now
    : rows.reduce((sum, row) => sum + row.height + gap, 0)
  return new Map(rows.map((row) => [row.key, row.before === undefined ? entry : row.before + row.carried - row.now]))
}

/** How much of a dropped line's bottom to cut so it stops `gap` short of the line rising under it. */
export function wipeCut(top: number, bottom: number, nextTop: number | null, gap: number): number {
  if (nextTop === null) return 0
  return Math.min(bottom - top, Math.max(0, bottom - nextTop + gap))
}

export const fmtSeconds = (ms: number) => `+${(ms / 1000).toFixed(2)}s`

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}
