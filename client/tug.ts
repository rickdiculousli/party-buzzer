export const CROSS_MARGIN = 0.05
export const CROSS_GAP_MS = 1500
export const ROPE_OMEGA = 9
export const ROPE_ZETA = 0.8
export const SWING_DEG = 22
export const SWING_MAX = 15

export function easeToward(current: number, target: number, dtMs: number, tauMs: number): number {
  if (dtMs <= 0) return current
  return target + (current - target) * Math.exp(-dtMs / tauMs)
}

export type Rope = { x: number; v: number }

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

export const swing = (v: number) => Math.max(-SWING_MAX, Math.min(SWING_MAX, v * SWING_DEG))

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

export const TENSE_ON = 0.6
export const TENSE_OFF = 0.5
export const STILL = 0.2
export const tense = (was: boolean, effort: [number, number], ropeV: number) =>
  Math.min(...effort) > (was ? TENSE_OFF : TENSE_ON) && Math.abs(ropeV) < (was ? STILL * 1.5 : STILL)

export type Crossing = { armed: -1 | 0 | 1; at: number }
export const NO_CROSSING: Crossing = { armed: 0, at: -Infinity }

export function watchCrossing(prev: Crossing, flag: number, nowMs: number): { next: Crossing; crossed: boolean } {
  if (prev.armed !== 0 && Math.sign(flag) === -prev.armed) {
    const crossed = nowMs - prev.at >= CROSS_GAP_MS
    return { next: { armed: 0, at: crossed ? nowMs : prev.at }, crossed }
  }
  const armed = flag > CROSS_MARGIN ? 1 : flag < -CROSS_MARGIN ? -1 : prev.armed
  return { next: { armed, at: prev.at }, crossed: false }
}
