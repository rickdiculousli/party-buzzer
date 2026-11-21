import type { ScoreKey, State } from './protocol.ts'
import { pickers } from './choice.ts'
import { scoreKey } from './scoring.ts'

export function allGuessed(state: State): boolean {
  const who = pickers(state)
  return who.length > 0 && who.every((id) => state.round.guesses?.[id] !== undefined)
}

export function formatNumber(n: number, plain = false): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 6, useGrouping: !plain })
}

export const CLOSEST_REVEAL = { landStepMs: 90, dropMs: 420, holdMs: 600, slideMs: 600, tadaMs: 800, stampMs: 260 }

export function closestTimes(guesses: number): { truthAt: number; lightAt: number; stampAt: number; doneAt: number } {
  const r = CLOSEST_REVEAL
  const truthAt = Math.max(0, guesses - 1) * r.landStepMs + r.dropMs + r.holdMs
  const lightAt = truthAt + r.slideMs
  const stampAt = lightAt + r.tadaMs / 2
  return { truthAt, lightAt, stampAt, doneAt: stampAt + r.stampMs }
}

export function scoresBeforeClosest(state: State): Record<ScoreKey, number> {
  const scores = { ...state.scores }
  for (const [id, points] of Object.entries(state.round.paid ?? {})) {
    const key = scoreKey(state, id)
    scores[key] = (scores[key] ?? 0) - points
  }
  return scores
}

const WILD = 2

export type LineScale = { lo: number; hi: number }

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

export function placeOn(scale: LineScale, x: number): { at: number; parked?: 'low' | 'high' } {
  if (x < scale.lo) return { at: 0, parked: 'low' }
  if (x > scale.hi) return { at: 1, parked: 'high' }
  return { at: (x - scale.lo) / (scale.hi - scale.lo) }
}
