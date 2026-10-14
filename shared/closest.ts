/**
 * Closest questions: who may guess, when everyone has, and the number line the
 * board lays the guesses on. Who may guess is `pickers`, the same room a
 * choice question waits for.
 */
import type { ScoreKey, State } from './protocol.ts'
import { pickers } from './choice.ts'
import { scoreKey } from './scoring.ts'

/** False with nobody eligible, so an empty room waits for the timer. */
export function allGuessed(state: State): boolean {
  const who = pickers(state)
  return who.length > 0 && who.every((id) => state.round.guesses?.[id] !== undefined)
}

/**
 * "1,665", "0.25". The same spelling on the pad, the line and the stamp.
 * `plain` drops the thousands comma, for a pack that writes its answer as a
 * year: "1989", never "1,989".
 */
export function formatNumber(n: number, plain = false): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6, useGrouping: !plain })
}

/**
 * The board's reveal, in ms: each guess lands a step after the last, the line
 * holds, the answer runs in, the nearest lights, then the stamp. The board
 * applies these as CSS delays; phones and the board's standings hold the old
 * picture until `doneAt`, and autoplay waits it out, so nobody's hand or the
 * standings tell the room before the wall does. `dropMs`, `tadaMs` and
 * `stampMs` are the kit's `--fx-drop-dur`, `--fx-tada-dur` and `--strike-dur`.
 */
export const CLOSEST_REVEAL = { landStepMs: 90, dropMs: 420, holdMs: 600, slideMs: 600, tadaMs: 800, stampMs: 260 }

export function closestTimes(guesses: number): { truthAt: number; lightAt: number; stampAt: number; doneAt: number } {
  const r = CLOSEST_REVEAL
  const truthAt = Math.max(0, guesses - 1) * r.landStepMs + r.dropMs + r.holdMs
  const lightAt = truthAt + r.slideMs
  const stampAt = lightAt + r.tadaMs / 2
  return { truthAt, lightAt, stampAt, doneAt: stampAt + r.stampMs }
}

/** The scores as they stood before a settled closest question paid, for the beat the reveal is still playing. */
export function scoresBeforeClosest(state: State): Record<ScoreKey, number> {
  const scores = { ...state.scores }
  for (const [id, points] of Object.entries(state.round.paid ?? {})) {
    const key = scoreKey(state, id)
    scores[key] = (scores[key] ?? 0) - points
  }
  return scores
}

/** How much wider than the rest an end guess's gap must be to park it. */
const WILD = 2

/** The span the line draws. Guesses outside it are parked at its ends. */
export type LineScale = { lo: number; hi: number }

/**
 * The line covers the answer and at least the middle 90 % of the guesses. A
 * wild guess would squash everyone else into a dot, so the outermost guesses
 * at an end are parked when the gap in from them is over twice as wide as all
 * the rest: the deepest such gap within the cap, so two wild guesses go
 * together. At most a twentieth of the guesses at each end, and at least one
 * once there are three. A margin keeps the end marks off the edges.
 */
export function lineScale(guesses: number[], truth: number): LineScale {
  const sorted = [...guesses].sort((a, b) => a - b)
  const cap = Math.ceil(sorted.length * 0.05)
  let first = 0
  let last = sorted.length - 1
  const span = (a: number, b: number) => Math.max(sorted[b], truth) - Math.min(sorted[a], truth)
  let park = 0
  for (let k = 1; k <= cap && last - k - first >= 1; k++) {
    if (sorted[last - k + 1] - Math.max(sorted[last - k], truth) > WILD * span(first, last - k)) park = k
  }
  last -= park
  park = 0
  for (let k = 1; k <= cap && last - first - k >= 1; k++) {
    if (Math.min(sorted[first + k], truth) - sorted[first + k - 1] > WILD * span(first + k, last)) park = k
  }
  first += park
  let lo = Math.min(truth, sorted[first] ?? truth)
  let hi = Math.max(truth, sorted[last] ?? truth)
  if (hi === lo) {
    const pad = Math.abs(lo) * 0.1 || 1
    lo -= pad
    hi += pad
  }
  const margin = (hi - lo) * 0.08
  return { lo: lo - margin, hi: hi + margin }
}

/** Where `x` sits along the line, 0 to 1, and which end parks it if it is off the line. */
export function placeOn(scale: LineScale, x: number): { at: number; parked?: 'low' | 'high' } {
  if (x < scale.lo) return { at: 0, parked: 'low' }
  if (x > scale.hi) return { at: 1, parked: 'high' }
  return { at: (x - scale.lo) / (scale.hi - scale.lo) }
}
