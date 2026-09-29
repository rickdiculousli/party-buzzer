import type { PokerFlick } from '../shared/protocol.ts'

/**
 * Cards and chips moving across felt, as pure kinematics modelled on hands.
 * A released card slides under constant friction: fast off the fingers, then
 * evenly slower into its rest. A pushed card first rides the hand, speeding
 * up, before it is let go. Spin is small and bleeds off more slowly than
 * speed, so a card keeps turning gently until it stops rather than squaring
 * up early. Units are pixels, degrees and ms.
 */
export type Pose = { x: number; y: number; rot: number }
export type Frame = Pose & { t: number; lift: number }

export const TOSS = {
  /** Deceleration along the cloth, px/ms². Lower slides further for the same launch. */
  friction: 0.0035,
  /** Share of the slide spent in the air before the card touches down. */
  airShare: 0.3,
  /** Extra scale at release, falling to nothing at touchdown. */
  lift: 0.04,
  /** Sideways bow of the path, as a share of its length. */
  wobble: 0.03,
  /** Share of the time the hand carries a pushed card before letting go; 0 is a throw. */
  hand: 0,
  /** How slowly spin bleeds off: 1 turns evenly to the end, 2 squares up as fast as the card slows. */
  spinEase: 1.3,
  stepMs: 16,
  /** The shortest slide, so a tiny nudge still reads as motion. */
  minMs: 180,
}

type Options = Partial<typeof TOSS>

const between = (rand: () => number, lo: number, hi: number) => lo + (hi - lo) * rand()
const sign = (rand: () => number) => (rand() < 0.5 ? -1 : 1)

/**
 * Distance covered by share `u` of the time, 0 to 1. With a hand phase the card
 * speeds up evenly until release, then friction slows it evenly to rest.
 */
function travelled(u: number, hand: number): number {
  if (hand <= 0) return 1 - (1 - u) ** 2
  if (u < hand) return (u * u) / hand
  return hand + 2 * (u - hand) - (u - hand) ** 2 / (1 - hand)
}

/** Moves from `from` to rest exactly on `to`, along a slightly bowed path. */
export function slide(from: Pose, to: Pose, rand: () => number, options: Options = {}): Frame[] {
  const o = { ...TOSS, ...options }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.hypot(dx, dy)
  // A released card's time follows from friction alone; a pushed one also spends the hand's share.
  const total = Math.max(o.minMs, Math.sqrt((2 * d) / o.friction) / (1 - o.hand / 2))
  const r = rand() * 2 - 1
  const bow = d * o.wobble * (r < 0 ? -1 : 1) * (0.3 + 0.7 * Math.abs(r))
  const nx = d ? -dy / d : 0
  const ny = d ? dx / d : 0
  const frames: Frame[] = []
  for (let t = 0; ; t = Math.min(total, t + o.stepMs)) {
    const u = t / total
    const along = travelled(u, o.hand)
    const side = bow * Math.sin(Math.PI * along)
    frames.push({
      t,
      x: from.x + dx * along + nx * side,
      y: from.y + dy * along + ny * side,
      rot: from.rot + (to.rot - from.rot) * (1 - (1 - u) ** o.spinEase),
      lift: o.lift * Math.max(0, 1 - u / o.airShare) ** 2,
    })
    if (t === total) break
  }
  frames[frames.length - 1] = { t: total, ...to, lift: 0 }
  return frames
}

/** A dealer's pitch: released low and flat, turning a little, easing onto its spot. */
export function pitch(dealer: { x: number; y: number }, spot: Pose, rand: () => number): Frame[] {
  const spin = sign(rand) * between(rand, 8, 45)
  return slide({ x: dealer.x, y: dealer.y, rot: spot.rot + spin }, spot, rand, { lift: 0.05 })
}

/** Below this flick speed a fold is pushed along the cloth rather than thrown. */
const PUSH_BELOW = 0.35

/**
 * A fold toward `aim`. A firm flick throws the cards from between the fingers
 * with a little spin, bent the way the flick went; a soft flick or a timeout
 * pushes them forward along the cloth instead.
 */
export function toss(from: Pose, aim: { x: number; y: number }, flick: PokerFlick | null, rand: () => number): { frames: Frame[]; rest: Pose } {
  const thrown = !!flick && flick.speed >= PUSH_BELOW
  const reach = Math.hypot(aim.x - from.x, aim.y - from.y)
  const angle = ((flick ? flick.dx * 30 : 0) + between(rand, -5, 5)) * (Math.PI / 180)
  const ux = reach ? (aim.x - from.x) / reach : 0
  const uy = reach ? (aim.y - from.y) / reach : -1
  const dirX = ux * Math.cos(angle) - uy * Math.sin(angle)
  const dirY = ux * Math.sin(angle) + uy * Math.cos(angle)
  const dist = reach * (thrown ? 0.55 + 0.45 * flick!.speed : flick ? 0.5 : 0.32) * between(rand, 0.9, 1.1)
  const spin = thrown
    ? (flick!.dx ? Math.sign(flick!.dx) : sign(rand)) * Math.min(80, (20 + 55 * flick!.speed) * between(rand, 0.8, 1.15))
    : between(rand, -10, 10)
  const rest = { x: from.x + dirX * dist, y: from.y + dirY * dist, rot: from.rot + spin }
  const frames = slide(from, rest, rand, thrown ? {} : { hand: 0.35, lift: 0, wobble: 0.01 })
  return { frames, rest }
}

/** The dealer drawing folded cards into the muck: a hand pulling them flat along the cloth. */
export function sweep(from: Pose, pile: Pose): Frame[] {
  return slide(from, pile, () => 0.5, { hand: 0.4, lift: 0, wobble: 0, friction: TOSS.friction * 0.6 })
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
