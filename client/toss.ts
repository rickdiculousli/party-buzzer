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
  airShare: 0.55,
  /** Share of its speed a card loses to the air before touchdown. */
  airDrag: 0.12,
  /** Extra scale at release, falling to nothing at touchdown. */
  lift: 0.05,
  /** Time constant of the cloth's drag on a sliding card, ms. */
  skidTau: 260,
  /** Constant friction that finally stops the slide, px/ms². */
  skidFriction: 0.0005,
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
  // With no lead phase (a zero-length move) there is nothing to spin through yet.
  const spinLead = (t: number) => pushed || leadMs <= 0 ? w0 * t : w0 * t - (w0 * o.airDrag * t * t) / (2 * leadMs)
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
    // The last frame is the full distance, whatever rounding the speed solve left.
    const share = !d || t === total ? 1 : Math.min(1, along / d)
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
  // Every pitch leaves the fingers a little differently: how far it flies, how it skids, how it spins.
  const frames = slide({ x: dealer.x, y: dealer.y, rot: spot.rot }, spot, rand, {
    spin: sign(rand) * between(rand, 0.35, 0.9),
    airShare: between(rand, 0.46, 0.64),
    skidTau: TOSS.skidTau * between(rand, 0.8, 1.2),
  })
  const extra = frames[frames.length - 1].rot - spot.rot
  return frames.map((f) => ({ ...f, rot: f.rot - extra }))
}

/** How a player takes delivery of their two cards. Distances are shares of a card's width or px. */
export const RECEIVE = {
  /** How far from its place a pitched card may land, as a share of a card's width. */
  scatter: 0.45,
  /** How far off square it may land, degrees. */
  scatterRot: 22,
  /** How long a player takes to reach for the pair once the second card is down, ms. */
  reactMs: [150, 450] as const,
  /** How askew the pair still is when the hand has drawn it together, degrees. */
  squareRot: 5,
  /** How deep a fingertip presses the pair into the cloth, as a share of its size. */
  tapDepth: [0.012, 0.03] as const,
  /** Each half of a tap, ms. */
  tapMs: [55, 90] as const,
  /** The pause between the two taps, ms. */
  tapGap: [80, 170] as const,
}

/** Where a pitched card lands: near its place, visibly off it, and turned a little. Fixed by `rand`. */
export function scatter(neat: Pose, cardW: number, rand: () => number): Pose {
  const angle = between(rand, 0, Math.PI * 2)
  const r = cardW * RECEIVE.scatter * (0.35 + 0.65 * rand())
  return { x: neat.x + Math.cos(angle) * r, y: neat.y + Math.sin(angle) * r, rot: neat.rot + sign(rand) * between(rand, 4, RECEIVE.scatterRot) }
}

/**
 * A dealt card from the dealer's pitch to the player's hand: it lies where
 * `flight` left it until `collectAt` (ms from this card's own start), is drawn
 * into the pair still a little askew, then two fingertip taps from above
 * press it into the cloth and square it exactly into `neat`. No two players
 * tap with quite the same depth or rhythm.
 */
export function receive(flight: Frame[], neat: Pose, collectAt: number, rand: () => number): Frame[] {
  const land = flight[flight.length - 1]
  const frames: Frame[] = [...flight]
  const start = Math.max(land.t, collectAt)
  if (start > land.t) frames.push({ ...land, t: start, lift: 0 })
  const near: Pose = { x: neat.x + between(rand, -3, 3), y: neat.y + between(rand, -3, 3), rot: neat.rot + sign(rand) * RECEIVE.squareRot }
  const drawn = slide(land, near, rand, { hand: 0.55, lift: 0, wobble: 0.01, skidTau: 70, skidFriction: 0.003, minMs: 220 })
  for (const f of drawn.slice(1)) frames.push({ ...f, t: f.t + start })
  // Each tap presses the pair down and lets it come back up, halfway square, then square.
  const mid: Pose = { x: (near.x + neat.x) / 2, y: (near.y + neat.y) / 2, rot: (near.rot + neat.rot) / 2 }
  let t = frames[frames.length - 1].t
  for (const settle of [mid, neat]) {
    const half = between(rand, ...RECEIVE.tapMs)
    t += half
    frames.push({ t, ...settle, lift: -between(rand, ...RECEIVE.tapDepth) })
    t += half
    frames.push({ t, ...settle, lift: 0 })
    if (settle === mid) {
      t += between(rand, ...RECEIVE.tapGap)
      frames.push({ t, ...settle, lift: 0 })
    }
  }
  return frames
}

/**
 * When each card of a deal leaves the dealer's hand, from 0: a human rhythm,
 * each gap a little short or long of `maxGap` (less for a big table), and the
 * whole deal inside `window`.
 */
export function dealSchedule(count: number, window: number, maxGap: number, rand: () => number): number[] {
  const base = Math.min(maxGap, window / Math.max(1, count - 1))
  const starts = [0]
  for (let i = 1; i < count; i++) starts.push(starts[i - 1] + base * between(rand, 0.7, 1.35))
  const last = starts[starts.length - 1]
  return last > window ? starts.map((s) => (s * window) / last) : starts
}

/** Below this flick speed a fold is pushed along the cloth rather than thrown. */
const PUSH_BELOW = 0.35

/**
 * A fold toward `aim`: a light toss off the fingertips, low and short with a
 * little turn, a firmer flick going a bit further and bending the way it
 * went. Spin varies widely, mostly low: squared, it leans hard toward barely
 * turning. A `wild` card is the one that got away and spins hard. A soft flick
 * or a timeout just pushes the cards forward. Whatever the
 * flick, the cards stop at least `keepClear` short of `aim`, so the middle of
 * the table stays clear.
 */
export function toss(from: Pose, aim: { x: number; y: number }, flick: PokerFlick | null, rand: () => number, keepClear = 0, wild = false): { frames: Frame[]; rest: Pose } {
  const thrown = !!flick && flick.speed >= PUSH_BELOW
  const reach = Math.hypot(aim.x - from.x, aim.y - from.y)
  const angle = ((flick ? flick.dx * 20 : 0) + between(rand, -5, 5)) * (Math.PI / 180)
  const ux = reach ? (aim.x - from.x) / reach : 0
  const uy = reach ? (aim.y - from.y) / reach : -1
  const dirX = ux * Math.cos(angle) - uy * Math.sin(angle)
  const dirY = ux * Math.sin(angle) + uy * Math.cos(angle)
  const wobble = thrown ? 0.02 : 0.01
  // Along any heading within a right angle of the aim, stopping `keepClear` short of it stays `keepClear` away; the bow gets its own margin.
  const room = Math.max(0, (reach - keepClear) / (1 + wobble))
  const dist = Math.min(room, reach * (thrown ? 0.2 + 0.25 * flick!.speed : flick ? 0.18 : 0.12) * between(rand, 0.9, 1.1))
  const way = flick?.dx ? Math.sign(flick.dx) : sign(rand)
  const turn = wild
    ? way * between(rand, 1.3, 2.1) * (thrown ? 1 : 0.6)
    : thrown
      ? way * (0.01 + 0.42 * flick!.speed * rand() ** 2)
      : way * 0.04 * rand() ** 2
  const target = { x: from.x + dirX * dist, y: from.y + dirY * dist, rot: from.rot }
  const frames = slide(from, target, rand, thrown
    ? { spin: turn, airShare: 0.3, lift: 0.025, wobble }
    : { hand: 0.35, lift: 0, wobble, spin: turn })
  const last = frames[frames.length - 1]
  return { frames, rest: { x: last.x, y: last.y, rot: last.rot } }
}

/** Which card of a folded pair spins away, if either: -1 for neither (most folds), else 0 or 1. */
export function wildCard(rand: () => number): -1 | 0 | 1 {
  if (rand() >= 0.35) return -1
  return rand() < 0.5 ? 0 : 1
}

/** The dealer drawing something in along the cloth, such as bets into the pot: flat, straight, unhurried. */
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
