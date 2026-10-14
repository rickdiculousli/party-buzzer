/**
 * Closest questions: who may guess, when everyone has, and the number line the
 * board lays the guesses on. Who may guess is `pickers`, the same room a
 * choice question waits for.
 */
import type { State } from './protocol.ts'
import { pickers } from './choice.ts'

/** False with nobody eligible, so an empty room waits for the timer. */
export function allGuessed(state: State): boolean {
  const who = pickers(state)
  return who.length > 0 && who.every((id) => state.round.guesses?.[id] !== undefined)
}

/** "1,665", "0.25". The same spelling on the pad, the line and the stamp. */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6 })
}

/** How much wider than the rest an end guess's gap must be to park it. */
const WILD = 3

/** The span the line draws. Guesses outside it are parked at its ends. */
export type LineScale = { lo: number; hi: number }

/**
 * The line covers the answer and at least the middle 90 % of the guesses. One
 * wild guess would squash everyone else into a dot, so an end guess is parked
 * when its gap to the rest is over three times as wide as all the rest: at
 * most a twentieth of the guesses at each end, and at least one once there are
 * three. A margin keeps the end marks off the edges.
 */
export function lineScale(guesses: number[], truth: number): LineScale {
  const sorted = [...guesses].sort((a, b) => a - b)
  const cap = Math.ceil(sorted.length * 0.05)
  let first = 0
  let last = sorted.length - 1
  const span = (a: number, b: number) => Math.max(sorted[b], truth) - Math.min(sorted[a], truth)
  for (let i = 0; i < cap && last - first >= 2; i++) {
    if (sorted[last] - Math.max(sorted[last - 1], truth) > WILD * span(first, last - 1)) last--
  }
  for (let i = 0; i < cap && last - first >= 2; i++) {
    if (Math.min(sorted[first + 1], truth) - sorted[first] > WILD * span(first + 1, last)) first++
  }
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
