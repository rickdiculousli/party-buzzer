import { revealProgress } from '../shared/scoring.ts'
import type { RevealWall } from '../shared/wall.ts'

/**
 * The board's picture reveal, as numbers: which instant of the reveal clock
 * the mosaic shows, and how coarse it is there. The canvas in
 * `RevealPicture.tsx` only draws what these say.
 */

/** The mosaic refines on this fixed step, never per frame. */
export const REVEAL_STEP_MS = 250
/** Cells across the picture's long side at the start: it is drawn through a 6 px canvas. */
export const REVEAL_FIRST_CELLS = 6
/**
 * How long the picture stays coarse. Cells grow geometrically from 6 to full
 * resolution against progress raised to this power, so the first half stays a
 * guess (about 20 cells across at the midpoint) and the last quarter
 * sharpens into the answer.
 */
export const REVEAL_EASE = 2

/**
 * The reveal-clock instant the board shows at server time `now`, or
 * `undefined` to keep whatever is up (a first press whose order is not
 * published yet). A held picture shows where it was held; an open one
 * steps on the clock in `REVEAL_STEP_MS` steps from `from`.
 */
export function revealShownAt(r: RevealWall, now: number): number | undefined {
  if (r.sharp) return r.until
  if (r.heldAt !== undefined) return r.heldAt
  if (!r.live) return undefined
  return r.from + Math.floor((now - r.from) / REVEAL_STEP_MS) * REVEAL_STEP_MS
}

/** Cells across the long side at instant `at`, for a picture `full` device pixels across. */
export function revealCells(r: Pick<RevealWall, 'from' | 'until'>, at: number, full: number): number {
  const p = revealProgress(r, at)
  if (p >= 1) return full
  const cells = Math.round(REVEAL_FIRST_CELLS * (full / REVEAL_FIRST_CELLS) ** (p ** REVEAL_EASE))
  return Math.min(full, Math.max(REVEAL_FIRST_CELLS, cells))
}
