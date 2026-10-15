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
 * Cells across just before the picture goes sharp. Aimed at what the room can
 * see, not at the canvas: on an 800 px picture across a room, past about a
 * hundred cells every step looks the same, and the last quarter would be a
 * still picture with 1.25x on offer.
 */
export const REVEAL_LAST_CELLS = 96
/**
 * Cells grow geometrically from first to last against progress raised to this
 * power: about 10 across at the end of the first quarter, 19 at the midpoint,
 * 41 at three quarters. The whole picture lands at `until`, on the same step as
 * the drop to the plain value.
 */
export const REVEAL_EASE = 1.25

/** `at` on the step grid from `from`, so a hold lands on a step the room has already seen. */
function step(r: Pick<RevealWall, 'from'>, at: number): number {
  return r.from + Math.floor((at - r.from) / REVEAL_STEP_MS) * REVEAL_STEP_MS
}

/**
 * The reveal-clock instant the board shows at server time `now`, or
 * `undefined` to keep whatever is up (a first press whose order is not
 * published yet). A held picture shows the step its press landed in; an open
 * one steps on the clock in `REVEAL_STEP_MS` steps from `from`.
 */
export function revealShownAt(r: RevealWall, now: number): number | undefined {
  if (r.sharp) return r.until
  if (r.heldAt !== undefined) return step(r, r.heldAt)
  if (!r.live) return undefined
  return step(r, now)
}

/** Server time of the step after `now`, for a timer that lands on the step rather than near it. */
export function nextRevealStep(r: Pick<RevealWall, 'from'>, now: number): number {
  return step(r, now) + REVEAL_STEP_MS
}

/** Cells across the long side at instant `at`, for a picture `full` device pixels across. */
export function revealCells(r: Pick<RevealWall, 'from' | 'until'>, at: number, full: number): number {
  const p = revealProgress(r, at)
  if (p >= 1) return full
  const cells = Math.round(REVEAL_FIRST_CELLS * (REVEAL_LAST_CELLS / REVEAL_FIRST_CELLS) ** (p ** REVEAL_EASE))
  return Math.min(full, Math.max(REVEAL_FIRST_CELLS, cells))
}
