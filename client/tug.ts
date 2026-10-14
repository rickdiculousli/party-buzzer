/** Pure rules for the Tug of war surfaces: how the drawn flag moves and when a swing cues. */

/** How far past the centre the drawn flag must be before it counts as the other half. */
export const CROSS_MARGIN = 0.05
/** Fewest ms between two swing cues. A swing inside the gap is taken silently. */
export const CROSS_GAP_MS = 1500
/** A swing cues only this soon after the flag passed the centre line, so a creeping flag never stamps late. */
export const CROSS_FRESH_MS = 250
/** The rope's natural frequency, rad/s, and damping ratio: heavy, settling in about half a second with a slight carry. */
export const ROPE_OMEGA = 9
export const ROPE_ZETA = 0.8
/** The flag's swing on its knot, degrees per unit of flag speed, and its limit. */
export const SWING_DEG = 22
export const SWING_MAX = 15

/** Exponential approach to `target`, independent of frame rate. */
export function easeToward(current: number, target: number, dtMs: number, tauMs: number): number {
  if (dtMs <= 0) return current
  return target + (current - target) * Math.exp(-dtMs / tauMs)
}

export type Rope = { x: number; v: number }

/**
 * The drawn flag as a mass on a damped spring toward the server's flag, so a
 * tap is a heave rather than a jolt. Fixed 4 ms substeps keep it the same at
 * any frame rate; a long gap (a hidden tab) snaps to the target.
 */
export function follow(rope: Rope, target: number, dtMs: number): Rope {
  if (dtMs > 500) return { x: target, v: 0 }
  let { x, v } = rope
  const steps = Math.max(1, Math.ceil(dtMs / 4))
  const h = dtMs / 1000 / steps
  for (let i = 0; i < steps; i++) {
    v += (ROPE_OMEGA * ROPE_OMEGA * (target - x) - 2 * ROPE_ZETA * ROPE_OMEGA * v) * h
    x += v * h
  }
  return { x, v }
}

/** Where the flag's lean on its knot heads: it trails the way the rope is moving. */
export const swing = (v: number) => Math.max(-SWING_MAX, Math.min(SWING_MAX, v * SWING_DEG))

/** The lean as a lightly damped pendulum chasing `swing(v)`, so a stopping knot swings it past vertical. */
export function lean(state: Rope, ropeV: number, dtMs: number): Rope {
  if (dtMs > 500) return { x: swing(ropeV), v: 0 }
  let { x, v } = state
  const target = swing(ropeV), omega = 14, zeta = 0.35
  const steps = Math.max(1, Math.ceil(dtMs / 4)), h = dtMs / 1000 / steps
  for (let i = 0; i < steps; i++) {
    v += (omega * omega * (target - x) - 2 * zeta * omega * v) * h
    x += v * h
  }
  return { x: Math.max(-2 * SWING_MAX, Math.min(2 * SWING_MAX, x)), v }
}

/** Effort above this shakes the flag, and it stops below `TENSE_OFF`, so the shake never flickers. */
export const TENSE_ON = 0.75
export const TENSE_OFF = 0.65
export const tense = (was: boolean, effort: [number, number]) => Math.min(...effort) > (was ? TENSE_OFF : TENSE_ON)

export type Crossing = { half: -1 | 0 | 1; at: number; side: -1 | 1; passedAt: number }
export const NO_CROSSING: Crossing = { half: 0, at: -Infinity, side: 1, passedAt: -Infinity }

/**
 * Watches the drawn flag for a swing to the other half. The first excursion
 * from the centre only picks a half. A swing past `CROSS_MARGIN` cues when the
 * flag passed the centre line within `CROSS_FRESH_MS` and no cue sounded in
 * the last `CROSS_GAP_MS`; otherwise the half changes without a sound, so a
 * cue never arrives late on a flag that is creeping or has stopped.
 */
export function watchCrossing(prev: Crossing, flag: number, nowMs: number): { next: Crossing; crossed: boolean } {
  const side = flag < 0 ? -1 : 1
  const passed = side !== prev.side ? { side, passedAt: nowMs } as const : { side: prev.side, passedAt: prev.passedAt }
  const half = flag > CROSS_MARGIN ? 1 : flag < -CROSS_MARGIN ? -1 : 0
  if (half === 0 || half === prev.half) return { next: { ...prev, ...passed }, crossed: false }
  const quiet = prev.half === 0 || nowMs - prev.at < CROSS_GAP_MS || nowMs - passed.passedAt > CROSS_FRESH_MS
  return { next: { half, at: quiet ? prev.at : nowMs, ...passed }, crossed: !quiet }
}
