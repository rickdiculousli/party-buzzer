/** Pure rules for the Tug of war surfaces: easing the drawn flag and when to cue a crossing. */

/** How far past the centre the flag must be before it counts as the other half. */
export const CROSS_MARGIN = 0.08
/** Fewest ms between two crossing cues. */
export const CROSS_GAP_MS = 1500
/** The drawn flag closes this fraction of the gap per `EASE_MS`-ish time constant. */
export const EASE_MS = 80

/** Exponential approach to `target`, independent of frame rate. */
export function easeToward(current: number, target: number, dtMs: number, tauMs = EASE_MS): number {
  if (dtMs <= 0) return current
  return target + (current - target) * Math.exp(-dtMs / tauMs)
}

export type Crossing = { half: -1 | 0 | 1; at: number }
export const NO_CROSSING: Crossing = { half: 0, at: -Infinity }

/**
 * Watches the flag for a swing to the other half. The first excursion from the
 * centre only picks a half. A swing needs the flag past `CROSS_MARGIN` on the
 * new side and `CROSS_GAP_MS` since the last cue; a swing held back by the gap
 * fires as soon as the gap has passed, if the flag is still over there.
 */
export function watchCrossing(prev: Crossing, flag: number, nowMs: number): { next: Crossing; crossed: boolean } {
  const half = flag > CROSS_MARGIN ? 1 : flag < -CROSS_MARGIN ? -1 : 0
  if (half === 0 || half === prev.half) return { next: prev, crossed: false }
  if (prev.half === 0) return { next: { half, at: prev.at }, crossed: false }
  if (nowMs - prev.at < CROSS_GAP_MS) return { next: prev, crossed: false }
  return { next: { half, at: nowMs }, crossed: true }
}
