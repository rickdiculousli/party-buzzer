import type { PokerFlick } from '../shared/protocol.ts'

/**
 * Cards and chips moving across felt, as pure kinematics in two phases.
 *
 * In the air a thrown card is fast and loses little speed, spinning freely.
 * At touchdown the cloth takes over: sliding slows exponentially (drag) with a
 * little constant friction that finally stops it, so the card crawls the last
 * stretch. Touching down bites into the spin, and the cloth then drags the
 * rest off on its own, quicker time scale. A pushed card never leaves the
 * cloth: it rides the hand, speeding up, and is let go into the same skid.
 * Units are pixels, degrees and ms.
 */
export type Pose = { x: number; y: number; rot: number }
export type Frame = Pose & { t: number; lift: number }

export const TOSS = {
  /** Share of a throw's distance covered in the air, before touchdown. 0 keeps it on the cloth. */
  airShare: 0.7,
  /** Share of its speed a card loses to the air before touchdown. */
  airDrag: 0.12,
  /** Extra scale at release, falling to nothing at touchdown. */
  lift: 0.05,
  /** Time constant of the cloth's drag on a sliding card, ms. */
  skidTau: 150,
  /** Constant friction that finally stops the slide, px/ms². */
  skidFriction: 0.0012,
  /** Share of a card's spin that survives touchdown. */
  impactSpin: 0.55,
  /** Time constant of the cloth's drag on spin, ms. Shorter than the slide's, so spin dies first. */
  spinTau: 90,
  /** Constant friction on spin, deg/ms². */
  spinFriction: 0.0015,
  /** Spin at release, deg/ms, signed. */
  spin: 0,
  /** Share of a push's distance the hand carries before letting go; set it to push rather than throw. */
  hand: 0,
  /** Sideways bow of the path, as a share of its length. */
  wobble: 0.03,
  stepMs: 16,
  /** The shortest move, so a tiny nudge still reads as motion. */
  minMs: 180,
}

type Options = Partial<typeof TOSS>

const between = (rand: () => number, lo: number, hi: number) => lo + (hi - lo) * rand()
const sign = (rand: () => number) => (rand() < 0.5 ? -1 : 1)

/** Distance and time a slide starting at `v` covers under drag `tau` and friction `mu` before it stops. */
function skidOf(v: number, tau: number, mu: number) {
  const time = tau * Math.log(1 + v / (mu * tau))
  return { time, dist: tau * v - mu * tau * time }
}
const skidAt = (t: number, v: number, tau: number, mu: number) => tau * (v + mu * tau) * (1 - Math.exp(-t / tau)) - mu * tau * t

/** The speed at which a skid covers exactly `dist`. */
function speedFor(dist: number, tau: number, mu: number): number {
  let lo = 0
  let hi = 50
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (skidOf(mid, tau, mu).dist < dist) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Moves from `from` to rest on `to`. Position ends exactly on `to`; the
 * card's own spin is added on top of turning from `from.rot` to `to.rot`, so
 * the last frame's rotation is `to.rot` plus whatever the spin came to.
 */
export function slide(from: Pose, to: Pose, rand: () => number, options: Options = {}): Frame[] {
  const o = { ...TOSS, ...options }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.hypot(dx, dy)
  const pushed = o.hand > 0
  const lead = d * (pushed ? o.hand : o.airShare)
  const v1 = Math.max(1e-3, speedFor(d - lead, o.skidTau, o.skidFriction))
  // A throw leaves the hand faster than it lands; a push reaches v1 in the hand.
  const v0 = pushed ? 0 : v1 / (1 - o.airDrag)
  const leadMs = lead > 0 ? (2 * lead) / (v0 + v1) : 0
  const skid = skidOf(v1, o.skidTau, o.skidFriction)
  const total = Math.max(o.minMs, leadMs + skid.time)

  // Spin: steady in the air (losing what the air takes), bitten at touchdown, then dragged off by the cloth.
  const w0 = o.spin
  const wLand = w0 * (pushed ? 1 : (1 - o.airDrag) * o.impactSpin)
  const spinLead = (t: number) => pushed ? w0 * t : w0 * t - (w0 * o.airDrag * t * t) / (2 * leadMs)
  const spinSkid = (t: number) => {
    const w = Math.abs(wLand)
    const k = o.spinFriction * o.spinTau
    const stop = o.spinTau * Math.log(1 + w / k)
    const u = Math.min(t, stop)
    return Math.sign(wLand) * (o.spinTau * (w + k) * (1 - Math.exp(-u / o.spinTau)) - k * u)
  }

  const r = rand() * 2 - 1
  const bow = d * o.wobble * (r < 0 ? -1 : 1) * (0.3 + 0.7 * Math.abs(r))
  const nx = d ? -dy / d : 0
  const ny = d ? dx / d : 0
  const frames: Frame[] = []
  for (let t = 0; ; t = Math.min(total, t + o.stepMs)) {
    let along: number
    let turned: number
    let lift = 0
    if (t < leadMs) {
      along = pushed ? (v1 * t * t) / (2 * leadMs) : v0 * t - ((v0 - v1) * t * t) / (2 * leadMs)
      turned = spinLead(t)
      if (!pushed) lift = o.lift * (1 - (t / leadMs) ** 2)
    } else {
      const u = Math.min(t - leadMs, skid.time)
      along = lead + skidAt(u, v1, o.skidTau, o.skidFriction)
      turned = spinLead(leadMs) + spinSkid(t - leadMs)
    }
    const share = d ? Math.min(1, along / d) : 1
    const side = bow * Math.sin(Math.PI * share)
    frames.push({
      t,
      x: from.x + dx * share + nx * side,
      y: from.y + dy * share + ny * side,
      rot: from.rot + (to.rot - from.rot) * share + turned,
      lift,
    })
    if (t === total) break
  }
  const last = frames[frames.length - 1]
  frames[frames.length - 1] = { ...last, x: to.x, y: to.y, lift: 0 }
  return frames
}

/** A dealer's pitch: it leaves the fingers spinning, lands, and the cloth drags it to rest square on its spot. */
export function pitch(dealer: { x: number; y: number }, spot: Pose, rand: () => number): Frame[] {
  const frames = slide({ x: dealer.x, y: dealer.y, rot: spot.rot }, spot, rand, { spin: sign(rand) * between(rand, 0.35, 0.9) })
  const extra = frames[frames.length - 1].rot - spot.rot
  return frames.map((f) => ({ ...f, rot: f.rot - extra }))
}

/** Below this flick speed a fold is pushed along the cloth rather than thrown. */
const PUSH_BELOW = 0.35

/**
 * A fold toward `aim`. A firm flick throws the cards from between the fingers,
 * spinning harder the harder the flick, bent the way it went; a soft flick or
 * a timeout pushes them forward along the cloth with barely any turn.
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
  const turn = thrown ? (flick!.dx ? Math.sign(flick!.dx) : sign(rand)) * (0.25 + 0.8 * flick!.speed) * between(rand, 0.8, 1.2) : between(rand, -0.04, 0.04)
  const target = { x: from.x + dirX * dist, y: from.y + dirY * dist, rot: from.rot }
  const frames = slide(from, target, rand, thrown ? { spin: turn } : { hand: 0.35, lift: 0, wobble: 0.01, spin: turn })
  const last = frames[frames.length - 1]
  return { frames, rest: { x: last.x, y: last.y, rot: last.rot } }
}

/** The dealer drawing folded cards into the muck: a hand pulling them flat along the cloth. */
export function sweep(from: Pose, pile: Pose): Frame[] {
  return slide(from, pile, () => 0.5, { hand: 0.5, lift: 0, wobble: 0, skidTau: 110 })
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
