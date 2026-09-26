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
    case 'reveal': return v.end === 'pass' ? `${nameOf(v.drawer)} passed` : v.end === 'all' ? 'Everyone got it' : 'Time'
    case 'over': return 'Match over'
  }
}

export const fmtSeconds = (ms: number) => `+${(ms / 1000).toFixed(2)}s`

export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}
