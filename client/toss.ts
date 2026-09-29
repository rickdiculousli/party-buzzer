import type { PokerFlick } from '../shared/protocol.ts'

/**
 * Cards and chips moving across felt, as pure kinematics. Everything slides
 * under constant friction, so it leaves fast and decelerates evenly into its
 * rest; a thrown card starts lifted and lands partway, a pushed one never
 * leaves the cloth. Units are pixels, degrees and ms.
 */
export type Pose = { x: number; y: number; rot: number }
export type Frame = Pose & { t: number; lift: number }

export const TOSS = {
  /** Deceleration along the cloth, px/ms². Lower slides further for the same launch. */
  friction: 0.0035,
  /** Share of the slide spent in the air before the card touches down. */
  airShare: 0.35,
  /** Extra scale at release, falling to nothing at touchdown. */
  lift: 0.08,
  /** Sideways bow of the path, as a share of its length. */
  wobble: 0.05,
  /** A small flutter that dies out as the card settles, in px. */
  jitterPx: 2.5,
  stepMs: 16,
  /** The shortest slide, so a tiny nudge still reads as motion. */
  minMs: 160,
}

type Options = Partial<typeof TOSS>

const between = (rand: () => number, lo: number, hi: number) => lo + (hi - lo) * rand()
const sign = (rand: () => number) => (rand() < 0.5 ? -1 : 1)

/** Slides from `from` to rest exactly on `to` under constant friction, with a bowed, fluttering path. */
export function slide(from: Pose, to: Pose, rand: () => number, options: Options = {}): Frame[] {
  const o = { ...TOSS, ...options }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.hypot(dx, dy)
  const total = Math.max(o.minMs, Math.sqrt((2 * d) / o.friction))
  // The bow's side and size, and the flutter's rate and phase, are this throw's own.
  const r = rand() * 2 - 1
  const bow = d * o.wobble * (r < 0 ? -1 : 1) * (0.3 + 0.7 * Math.abs(r))
  const flutterRate = between(rand, 2, 4)
  const flutterPhase = between(rand, 0, Math.PI * 2)
  const nx = d ? -dy / d : 0
  const ny = d ? dx / d : 0
  const frames: Frame[] = []
  for (let t = 0; ; t = Math.min(total, t + o.stepMs)) {
    const u = t / total
    // Constant deceleration: distance covered is 1 - (1 - u)².
    const eased = 1 - (1 - u) ** 2
    const side = bow * Math.sin(Math.PI * u) + o.jitterPx * Math.sin(2 * Math.PI * flutterRate * u + flutterPhase) * (1 - u) ** 2 * Math.sin(Math.PI * u)
    frames.push({
      t,
      x: from.x + dx * eased + nx * side,
      y: from.y + dy * eased + ny * side,
      rot: from.rot + (to.rot - from.rot) * eased,
      lift: o.lift * Math.max(0, 1 - u / o.airShare) ** 2,
    })
    if (t === total) break
  }
  frames[frames.length - 1] = { t: total, ...to, lift: 0 }
  return frames
}

/** A dealer's pitch: the card leaves the dealer spinning and sheds the spin as it settles on its spot. */
export function pitch(dealer: { x: number; y: number }, spot: Pose, rand: () => number): Frame[] {
  const spin = sign(rand) * between(rand, 40, 160)
  return slide({ x: dealer.x, y: dealer.y, rot: spot.rot + spin }, spot, rand)
}

/**
 * A fold thrown toward `aim`. A flick sets how hard and which way it bends; a
 * timeout, with no flick, only pushes the cards a little way along the cloth.
 */
export function toss(from: Pose, aim: { x: number; y: number }, flick: PokerFlick | null, rand: () => number): { frames: Frame[]; rest: Pose } {
  const reach = Math.hypot(aim.x - from.x, aim.y - from.y)
  const angle = ((flick ? flick.dx * 35 : 0) + between(rand, -6, 6)) * (Math.PI / 180)
  const ux = reach ? (aim.x - from.x) / reach : 0
  const uy = reach ? (aim.y - from.y) / reach : -1
  const dirX = ux * Math.cos(angle) - uy * Math.sin(angle)
  const dirY = ux * Math.sin(angle) + uy * Math.cos(angle)
  const dist = reach * (flick ? 0.55 + 0.5 * flick.speed : 0.35) * between(rand, 0.9, 1.1)
  const spin = flick
    ? (flick.dx ? Math.sign(flick.dx) : sign(rand)) * (60 + 420 * flick.speed) * between(rand, 0.8, 1.2)
    : between(rand, -12, 12)
  const rest = { x: from.x + dirX * dist, y: from.y + dirY * dist, rot: from.rot + spin }
  const frames = slide(from, rest, rand, flick ? {} : { lift: 0, wobble: 0.015, friction: TOSS.friction * 2 })
  return { frames, rest }
}

/** The dealer drawing folded cards into the muck: flat on the cloth, straight, unhurried. */
export function sweep(from: Pose, pile: Pose): Frame[] {
  return slide(from, pile, () => 0.5, { lift: 0, wobble: 0, jitterPx: 0, friction: TOSS.friction * 0.6 })
}

/** A frame list that travels `a`, holds its end for `holdMs`, then travels `b`. */
export function chain(a: Frame[], holdMs: number, b: Frame[]): Frame[] {
  const end = a[a.length - 1]
  const at = end.t + holdMs
  return [...a, { ...end, t: at }, ...b.slice(1).map((f) => ({ ...f, t: f.t + at }))]
}

const DENOMINATIONS = [500, 100, 25, 5, 1]
const MAX_CHIPS = 10

/** The chips a bet is built from, fewest possible, biggest first; a tall stack is capped. */
export function chipStack(amount: number): number[] {
  const out: number[] = []
  let left = Math.max(0, Math.floor(amount))
  for (const value of DENOMINATIONS) {
    while (left >= value && out.length < MAX_CHIPS) {
      out.push(value)
      left -= value
    }
  }
  return out
}
