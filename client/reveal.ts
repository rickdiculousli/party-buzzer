import { revealProgress } from '../shared/scoring.ts'
import type { RevealWall } from '../shared/wall.ts'

export const REVEAL_STEP_MS = 250
export const REVEAL_FIRST_CELLS = 6
export const REVEAL_LAST_CELLS = 96
export const REVEAL_EASE = 1.25

function step(r: Pick<RevealWall, 'from'>, at: number): number {
  return r.from + Math.floor((at - r.from) / REVEAL_STEP_MS) * REVEAL_STEP_MS
}

export function revealShownAt(r: RevealWall, now: number): number | undefined {
  if (r.sharp) return r.until
  if (r.heldAt !== undefined) return step(r, r.heldAt)
  if (!r.live) return undefined
  return Math.min(r.until, step(r, Math.max(now, r.opensAt)))
}

export const REVEAL_WHOLE_GRACE_MS = 150

export function revealDrawnAt(r: RevealWall, shown: number, now: number): number {
  if (!r.live || shown < r.until || now >= r.until + REVEAL_WHOLE_GRACE_MS) return shown
  return step(r, r.until - 1)
}

export function nextRevealStep(r: Pick<RevealWall, 'from'>, now: number): number {
  return step(r, now) + REVEAL_STEP_MS
}

export function revealCells(r: Pick<RevealWall, 'from' | 'until'>, at: number, full: number): number {
  const p = revealProgress(r, at)
  if (p >= 1) return full
  const cells = REVEAL_FIRST_CELLS * (REVEAL_LAST_CELLS / REVEAL_FIRST_CELLS) ** (p ** REVEAL_EASE)
  return Math.min(full, Math.max(REVEAL_FIRST_CELLS, cells))
}
