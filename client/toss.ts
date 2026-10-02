import type { PokerFlick } from '../shared/protocol.ts'
import type { Cue } from './sound.ts'

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
/**
 * `turn`, when a move has one, is how far a card is turned over about its
 * hinge in degrees: ±180 face down, 0 face up. `z`, when it has one, is its
 * place in a pile, higher on top.
 */
export type Frame = Pose & { t: number; lift: number; turn?: number; z?: number }

/**
 * Thin a sampled path before handing it to the browser. Error is measured at
 * the original timestamps, so native linear interpolation preserves its pace.
 * Contacts, pauses, taps, turn endpoints and stacking changes stay exact.
 */
export function simplifyFrames(frames: Frame[]): Frame[] {
  if (frames.length < 3) return frames
  const keep = new Set([0, frames.length - 1])
  const samePose = (a: Frame, b: Frame) => a.x === b.x && a.y === b.y && a.rot === b.rot && a.lift === b.lift && a.turn === b.turn
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i], c = frames[i + 1]
    if (a.z !== b.z || (a.lift > 0 && b.lift <= 0) || (a.turn !== b.turn && (Math.abs(a.turn ?? 0) === 180 || b.turn === 0))) {
      keep.add(i - 1); keep.add(i)
    }
    if (c && (samePose(a, b) !== samePose(b, c) || (b.lift - a.lift) * (c.lift - b.lift) < 0)) keep.add(i)
  }
  const anchors = [...keep].sort((a, b) => a - b)
  const pending = anchors.slice(1).map((end, i) => [anchors[i], end])
  while (pending.length) {
    const [start, end] = pending.pop()!
    const a = frames[start], b = frames[end]
    let worst = 1, at = -1
    for (let i = start + 1; i < end; i++) {
      const f = frames[i], share = (f.t - a.t) / (b.t - a.t || 1)
      const lerp = (x: number, y: number) => x + (y - x) * share
      const error = Math.max(
        Math.hypot(f.x - lerp(a.x, b.x), f.y - lerp(a.y, b.y)) / 0.3,
        Math.abs(f.rot - lerp(a.rot, b.rot)) / 0.25,
        Math.abs(f.lift - lerp(a.lift, b.lift)) / 0.0006,
        Math.abs((f.turn ?? 0) - lerp(a.turn ?? 0, b.turn ?? 0)) / 0.25,
      )
      if (error > worst) { worst = error; at = i }
    }
    if (at >= 0) { keep.add(at); pending.push([start, at], [at, end]) }
  }
  return [...keep].sort((a, b) => a - b).map((i) => frames[i])
}

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
export function pitch(dealer: { x: number; y: number }, spot: Pose, rand: () => number, spin: readonly [number, number] = [0.35, 0.9]): Frame[] {
  // Every pitch leaves the fingers a little differently: how far it flies, how it skids, how it spins.
  const frames = slide({ x: dealer.x, y: dealer.y, rot: spot.rot }, spot, rand, {
    spin: sign(rand) * between(rand, ...spin),
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
 * When each card of a deal to `seats` players leaves the dealer's hand, from 0:
 * a human rhythm, each gap a little short or long of `gap`, with a longer
 * `round` before the second card goes round, and the whole deal inside `window`.
 */
export function dealSchedule(seats: number, gap: number, round: number, window: number, rand: () => number): number[] {
  const starts = [0]
  for (let i = 1; i < seats * 2; i++) starts.push(starts[i - 1] + (i === seats ? round : gap) * between(rand, 0.75, 1.25))
  const last = starts[starts.length - 1]
  return last > window ? starts.map((s) => (s * window) / last) : starts
}

/** How the dealer lays out the community cards. Distances are shares of a card's width. */
export const REVEAL = {
  /** How long a street lies face down before the dealer turns it over, ms. */
  beatMs: [150, 300] as const,
  /** The turn itself, ms. */
  turnMs: 360,
  /**
   * Where the hinge a card turns over on sits, as a share of its width in from
   * the side it tips away from: a card is turned over by lifting one edge, so it
   * rocks on the other and comes down most of a card's width over.
   */
  hinge: 0.85,
  /** The pause between turning the cards over and moving them into line, ms. */
  afterTurnMs: [60, 140] as const,
  /** How far right of the first slot the flop's stack lands. */
  stackIn: [0.1, 0.3] as const,
  /** How far off square the stack lands, degrees. */
  stackRot: [3, 9] as const,
  /** How far each card of the stack sits ahead of the one under it, the way it was thrown. */
  stackStep: [0.05, 0.09] as const,
  /** How much further each card of the stack rides on the one under it as the stack skids to rest. */
  stackFan: [0.08, 0.14] as const,
  /** How far each card of the stack is twisted on the one under it, degrees. */
  stackTwist: [1.5, 3.5] as const,
  /** How far from its slot a turn or river card lands. */
  offSlot: [0.15, 0.35] as const,
  /** How far off square a turn or river card lands, degrees. */
  offRot: [4, 12] as const,
  /** Each card of the spread is let go a little after the one under it, up to this, ms. */
  spreadLag: 30,
}

/** A card drawn a short way along the cloth under the dealer's hand. */
const nudge = (from: Pose, to: Pose, rand: () => number) =>
  slide(from, to, rand, { hand: 0.6, lift: 0, wobble: 0.01, skidTau: 80, skidFriction: 0.003, minMs: 200 })

/** The face-down hold before a turn over, the turn, and the pause after it: returns when it turns and how long it all lasts. */
function turnOver(landedAt: number, rand: () => number) {
  const beat = between(rand, ...REVEAL.beatMs)
  return { turnAt: landedAt + beat, holdMs: beat + REVEAL.turnMs + between(rand, ...REVEAL.afterTurnMs) }
}

/** A frame list's pose at `t`, between its frames. */
function poseAt(frames: Frame[], t: number): Frame {
  const i = frames.findIndex((f) => f.t >= t)
  if (i <= 0) return { ...frames[i < 0 ? frames.length - 1 : 0], t }
  const [a, b] = [frames[i - 1], frames[i]]
  const u = (t - a.t) / (b.t - a.t)
  const mix = (p: number, q: number) => p + (q - p) * u
  return { t, x: mix(a.x, b.x), y: mix(a.y, b.y), rot: mix(a.rot, b.rot), lift: mix(a.lift, b.lift) }
}

/**
 * The card turned over at `at` about its hinge (`hinge`, a share of its width
 * from its left edge), face down until then and face up after. The turn's
 * sign is the one that lifts the far side off the table rather than through
 * it. The turn is sampled finely, since a frame list otherwise only has its
 * ends through a hold.
 */
function turnedOver(frames: Frame[], at: number, hinge: number): Frame[] {
  const down = hinge > 0.5 ? 180 : -180
  const end = at + REVEAL.turnMs
  const turn = (t: number) => t <= at ? down : t >= end ? 0 : down * (0.5 + 0.5 * Math.cos((Math.PI * (t - at)) / REVEAL.turnMs))
  const samples = Array.from({ length: Math.ceil(REVEAL.turnMs / TOSS.stepMs) }, (_, k) => at + (k + 1) * TOSS.stepMs).filter((t) => t < end)
  const times = [...new Set([...frames.map((f) => f.t), at, ...samples, end])].sort((p, q) => p - q)
  return times.map((t) => ({ ...(frames.find((f) => f.t === t) ?? poseAt(frames, t)), turn: turn(t) }))
}

/**
 * The flop, as a dealer lays it out: the three cards pitched as one face-down
 * stack that lands askew left of the first slot, a beat, the stack turned over
 * as one at `turnAt` (ms) on a hinge by its left edge, so it comes down just
 * right of that slot, then one push of the hand spreads it left to right. The
 * top card (the last) rides the hand furthest; each card ends exactly on its
 * slot. The frames' poses are where each card lies face up; face down it lies
 * the hinge's swing to the left of them.
 */
export function flop(dealer: { x: number; y: number }, slots: Pose[], cardW: number, rand: () => number): { frames: Frame[][]; turnAt: number; hinge: number } {
  const stack: Pose = {
    x: slots[0].x + cardW * between(rand, ...REVEAL.stackIn),
    y: slots[0].y + cardW * between(rand, -0.12, 0.12),
    rot: slots[0].rot + sign(rand) * between(rand, ...REVEAL.stackRot),
  }
  const flight = pitch(dealer, stack, rand, [0.15, 0.4])
  const { turnAt, holdMs } = turnOver(flight[flight.length - 1].t, rand)
  const lag = between(rand, 0, REVEAL.spreadLag)
  const hinge = 1 - REVEAL.hinge
  const reach = Math.hypot(stack.x - dealer.x, stack.y - dealer.y) || 1
  const fwd = { x: (stack.x - dealer.x) / reach, y: (stack.y - dealer.y) / reach }
  // Squared by hand, not by machine: each card sits a little ahead and twisted on the one under it, so all three show.
  // Once the stack is down, the cloth grips the bottom card while each card above slides on card, so it rides a little further.
  const offsets: (Pose & { fan: number })[] = [{ x: 0, y: 0, rot: 0, fan: 0 }]
  for (let k = 1; k < slots.length; k++) {
    const angle = Math.atan2(fwd.y, fwd.x) + between(rand, -0.6, 0.6)
    const r = cardW * between(rand, ...REVEAL.stackStep)
    const below = offsets[k - 1]
    offsets.push({
      x: below.x + Math.cos(angle) * r,
      y: below.y + Math.sin(angle) * r,
      rot: below.rot + sign(rand) * between(rand, ...REVEAL.stackTwist),
      fan: below.fan + cardW * between(rand, ...REVEAL.stackFan),
    })
  }
  // How much of the skid the stack has covered, 0 in the air to 1 at rest.
  const touchdown = flight.find((f, i) => i > 0 && f.lift <= 0) ?? flight[flight.length - 1]
  const along = (f: Pose) => (f.x - dealer.x) * fwd.x + (f.y - dealer.y) * fwd.y
  const skidLen = along(stack) - along(touchdown)
  const skidded = (f: Frame) => f.lift > 0 || skidLen <= 0 ? 0 : Math.min(1, Math.max(0, (along(f) - along(touchdown)) / skidLen))
  // Face down, the first card dealt is on top; turning the stack over puts the last on top.
  const frames = slots.map((slot, k) => {
    const o = offsets[slots.length - 1 - k]
    const shift = <P extends Pose>(f: P, fan: number): P => ({ ...f, x: f.x + o.x + fwd.x * fan, y: f.y + o.y + fwd.y * fan, rot: f.rot + o.rot })
    return turnedOver(chain(flight.map((f) => shift(f, o.fan * skidded(f))), holdMs + k * lag, nudge(shift(stack, o.fan), slot, rand)), turnAt, hinge)
      .map((f) => ({ ...f, z: Math.abs(f.turn!) > 90 ? slots.length - k : k + 1 }))
  })
  return { frames, turnAt, hinge }
}

/**
 * A player showing the cards that lie face down at `faceDown`, turned over as
 * one toward `toward` (the middle of the table): lifted by the far side, they
 * turn about one line 1 − `REVEAL.hinge` of a card in from the pile's near
 * edge and come down mirrored over it, so the card that was underneath ends on
 * top. Each card's `hinge` is that line as a share of its own width; face down,
 * each lies exactly where it already was.
 */
export function turnUp(faceDown: Pose[], toward: { x: number; y: number }, cardW: number): { frames: Frame[]; rest: Pose; hinge: number }[] {
  const a = (faceDown.reduce((sum, p) => sum + p.rot, 0) / faceDown.length) * (Math.PI / 180)
  const across = { x: Math.cos(a), y: Math.sin(a) }
  const at = faceDown.map((p) => p.x * across.x + p.y * across.y)
  const mid = faceDown.reduce((sum, p) => ({ x: sum.x + p.x / faceDown.length, y: sum.y + p.y / faceDown.length }), { x: 0, y: 0 })
  const forward = (toward.x - mid.x) * across.x + (toward.y - mid.y) * across.y >= 0
  const inset = (1 - REVEAL.hinge) * cardW
  const pivot = forward ? Math.max(...at) + cardW / 2 - inset : Math.min(...at) - cardW / 2 + inset
  return faceDown.map((p, k) => {
    const hinge = (at[k] - pivot) / cardW + 0.5
    const r = (p.rot * Math.PI) / 180
    const swing = (1 - 2 * hinge) * cardW
    const rest = { x: p.x + Math.cos(r) * swing, y: p.y + Math.sin(r) * swing, rot: p.rot }
    const still = [{ ...rest, t: 0, lift: 0 }, { ...rest, t: REVEAL.turnMs, lift: 0 }]
    // Face down the later card is on top; turned over, the pile is too.
    const frames = turnedOver(still, 0, hinge).map((f) => ({ ...f, z: Math.abs(f.turn!) > 90 ? k + 1 : faceDown.length - k }))
    return { frames, rest, hinge }
  })
}

/** A turn or river card: pitched face down to land a little off its slot, turned over at `turnAt` (ms) toward the board, then drawn into line. */
export function street(dealer: { x: number; y: number }, slot: Pose, cardW: number, rand: () => number): { frames: Frame[]; turnAt: number; hinge: number } {
  const angle = between(rand, 0, Math.PI * 2)
  const r = cardW * between(rand, ...REVEAL.offSlot)
  const off: Pose = { x: slot.x + Math.cos(angle) * r, y: slot.y + Math.sin(angle) * r, rot: slot.rot + sign(rand) * between(rand, ...REVEAL.offRot) }
  const flight = pitch(dealer, off, rand)
  const { turnAt, holdMs } = turnOver(flight[flight.length - 1].t, rand)
  // Hinged by its right edge, so face down it lies out past the board's end rather than over the card beside it.
  const hinge = REVEAL.hinge
  return { frames: turnedOver(chain(flight, holdMs, nudge(off, slot, rand)), turnAt, hinge), turnAt, hinge }
}

/** How a fold leaves the fingertips. Reaches are shares of the way from the seat to the middle. */
export const FOLD = {
  /** Below this flick speed a fold is pushed along the cloth rather than thrown. */
  pushBelow: 0.35,
  /** How far the gentlest throw goes. */
  reachThrown: 0.28125,
  /** How much further a throw goes at full flick speed. */
  reachFlick: 0.34375,
  /** How far a soft flick pushes the cards. */
  reachSoft: 0.25,
  /** How far a timeout nudges the cards. */
  reachTimeout: 0.171875,
  /** Each card's push varies by up to this share either way. */
  reachVary: 0.25,
  /** Each card's heading varies by up to this either way, degrees. */
  heading: 12,
  /** How far a flick to one side bends the throw that way, degrees at a full sideways flick. */
  bend: 20,
  /** A quiet card's spin at full flick speed, before the squared roll that keeps most barely turning, deg/ms. */
  spinQuiet: 0.55,
  /** A wild card's spin, deg/ms. */
  spinWild: [1.3, 2.1] as const,
}

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
  const thrown = !!flick && flick.speed >= FOLD.pushBelow
  const reach = Math.hypot(aim.x - from.x, aim.y - from.y)
  // Each card leaves the fingertips on its own line and with its own push, so a pair parts ways a little.
  const angle = ((flick ? flick.dx * FOLD.bend : 0) + between(rand, -FOLD.heading, FOLD.heading)) * (Math.PI / 180)
  const ux = reach ? (aim.x - from.x) / reach : 0
  const uy = reach ? (aim.y - from.y) / reach : -1
  const dirX = ux * Math.cos(angle) - uy * Math.sin(angle)
  const dirY = ux * Math.sin(angle) + uy * Math.cos(angle)
  const wobble = thrown ? 0.02 : 0.01
  // Along any heading within a right angle of the aim, stopping `keepClear` short of it stays `keepClear` away; the bow gets its own margin.
  const room = Math.max(0, (reach - keepClear) / (1 + wobble))
  const share = thrown ? FOLD.reachThrown + FOLD.reachFlick * flick!.speed : flick ? FOLD.reachSoft : FOLD.reachTimeout
  const dist = Math.min(room, reach * share * between(rand, 1 - FOLD.reachVary, 1 + FOLD.reachVary))
  const way = flick?.dx ? Math.sign(flick.dx) : sign(rand)
  const turn = wild
    ? way * between(rand, ...FOLD.spinWild) * (thrown ? 1 : 0.6)
    : thrown
      ? way * (0.01 + FOLD.spinQuiet * flick!.speed * rand() ** 2)
      : way * 0.04 * rand() ** 2
  const target = { x: from.x + dirX * dist, y: from.y + dirY * dist, rot: from.rot }
  const frames = slide(from, target, rand, thrown
    ? { spin: turn, airShare: 0.3, lift: 0.025, wobble }
    : { hand: 0.35, lift: 0, wobble, spin: turn })
  // A fold leaves the felt, not a hand held above it: its lift rises from nothing and comes back down.
  const air = contacts(frames).air
  const lifted = thrown && air ? frames.map((f) => f.t < air ? { ...f, lift: frames[0].lift * Math.sin((Math.PI * f.t) / air) } : f) : frames
  const last = lifted[lifted.length - 1]
  return { frames: lifted, rest: { x: last.x, y: last.y, rot: last.rot } }
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

/**
 * When a move makes a sound, in ms from its start: `air`, how long it flies
 * before it first touches down (0 if it never leaves the cloth), `tap` as a
 * fingertip presses it into the cloth, `flip` as a card starts to turn over,
 * and `stop` at its last frame. A card landing on felt makes none.
 */
export function contacts(frames: Frame[]): { air: number; tap: number[]; flip: number[]; stop: number } {
  const tap: number[] = [], flip: number[] = []
  let air = 0
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i]
    if (!air && a.lift > 0 && b.lift <= 0) air = b.t
    if (a.lift >= 0 && b.lift < 0) tap.push(b.t)
    if (Math.abs(a.turn ?? 0) === 180 && b.turn !== undefined && Math.abs(b.turn) < 180) flip.push(a.t)
  }
  return { air, tap, flip, stop: frames.at(-1)?.t ?? 0 }
}

/** The cue a moving piece plays at each kind of contact. `air` plays only if it flies. */
export type PieceSound = Partial<Record<'start' | 'air' | 'tap' | 'flip' | 'stop', Cue>>

/**
 * When each of a move's sounds plays, in ms from its start. The `air` whoosh
 * starts at release and carries the flight's length, so it can be fitted to
 * end as the card touches down.
 */
export function soundPlan(sound: PieceSound, frames: Frame[]): { cue: Cue; at: number; airMs?: number }[] {
  const at = contacts(frames)
  const out: { cue: Cue; at: number; airMs?: number }[] = []
  if (sound.air && at.air) out.push({ cue: sound.air, at: 0, airMs: at.air })
  const hits: [Cue | undefined, number[]][] = [[sound.start, [0]], [sound.tap, at.tap], [sound.flip, at.flip], [sound.stop, [at.stop]]]
  for (const [cue, times] of hits) if (cue) for (const t of times) out.push({ cue, at: t })
  return out
}

/** A frame list that travels `a`, holds its end for `holdMs`, then travels `b`. */
export function chain(a: Frame[], holdMs: number, b: Frame[]): Frame[] {
  const end = a[a.length - 1]
  const at = end.t + holdMs
  return [...a, { ...end, t: at }, ...b.slice(1).map((f) => ({ ...f, t: f.t + at }))]
}

const DENOMINATIONS = [500, 100, 25, 5, 1]
const MAX_CHIPS = 10

/** The chips a bet is built from, fewest possible, biggest first; a tall stack is capped at `max`. */
export function chipStack(amount: number, max = MAX_CHIPS): number[] {
  const out: number[] = []
  let left = Math.max(0, Math.floor(amount))
  for (const value of DENOMINATIONS) {
    while (left >= value && out.length < max) {
      out.push(value)
      left -= value
    }
  }
  return out
}

/** A stack in the pot, placed in chip widths from the pot's middle. */
export type PotStack = { x: number; y: number; chips: number[] }
/**
 * Where the pot's stacks stand, in chip widths, in the order they are started:
 * a corral packed round the middle, ring by ring, each ring from the side
 * away from the board first.
 */
const around = (count: number, r: number, turn: number) => Array.from({ length: count }, (_, k) => (turn + (k * 360) / count) % 360)
  .sort((a, b) => Math.abs(((a + 180) % 360) - 180) - Math.abs(((b + 180) % 360) - 180))
  .map((deg) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r])
const POT_SPOTS = [[0, 0], ...around(6, 1, 0), ...around(12, 1.95, 15)]
const POT_STACK_MAX = 10

/**
 * Bets pushed into the pot as they stood: usually one is pushed onto a
 * stack already there, if it fits; otherwise it stands on its own in the next
 * spot. Returns the pot and the stack each bet went to.
 */
export function gather(pot: PotStack[], bets: number[][], rand: () => number): { pot: PotStack[]; onto: number[] } {
  const out = pot.map((stack) => ({ ...stack, chips: [...stack.chips] }))
  const onto = bets.map((chips) => {
    const fits = out.flatMap((stack, i) => stack.chips.length + chips.length <= POT_STACK_MAX ? [i] : [])
    const room = out.length < POT_SPOTS.length
    let i: number
    if (fits.length && (!room || rand() < 0.75)) i = fits[Math.floor(rand() * fits.length)]
    else if (room) {
      const [x, y] = POT_SPOTS[out.length]
      out.push({ x: x + between(rand, -0.08, 0.08), y: y + between(rand, -0.08, 0.08), chips: [] })
      i = out.length - 1
    } else i = out.reduce((low, stack, j) => stack.chips.length < out[low].chips.length ? j : low, 0)
    out[i].chips.push(...chips.slice(0, POT_STACK_MAX - out[i].chips.length))
    return i
  })
  return { pot: out, onto }
}

/** How far each chip raises a stack, in chip widths (the CSS `--step`). */
export const CHIP_STEP = 0.05
/** How tall a chip's top looks against its width, the table seen a little from the front (the CSS `--face-height`); depth on the felt shortens the same way. */
export const CHIP_FACE = 0.9

/**
 * The shadows taller stacks cast across the top of a lower one: for each
 * taller stack, where its column meets the lower top, relative to that top's
 * middle, and how far the shadow runs from there (`dx`, `dy`), straight away
 * from the lamp, one chip step per chip of drop, as from a lamp well up to one
 * side. Stacks and the lamp are in pixels; `chipW` is a chip's width.
 */
export function topShades(stacks: { x: number; y: number; n: number }[], lamp: { x: number; y: number }, chipW: number): { x: number; y: number; dx: number; dy: number }[][] {
  return stacks.map((low) => stacks.flatMap((high) => {
    if (high.n <= low.n || !low.n) return []
    const x = high.x - low.x
    const y = high.y - low.y
    const away = Math.hypot(high.x - lamp.x, high.y - lamp.y) || 1
    const run = chipW * CHIP_STEP * (high.n - low.n)
    const dx = ((high.x - lamp.x) / away) * run
    const dy = ((high.y - lamp.y) / away) * run
    // Only a shadow that reaches this top: the caster's column, drawn out along the cast, overlaps it.
    const t = Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)))
    return Math.hypot(x + dx * t, y + dy * t) < chipW ? [{ x, y, dx, dy }] : []
  }))
}

/** A pot seen all at once, as after a reload: its chips in a few stacks of eight. */
export function potOf(amount: number, rand: () => number): PotStack[] {
  const chips = chipStack(amount, 48)
  const bets = Array.from({ length: Math.ceil(chips.length / 8) }, (_, i) => chips.slice(i * 8, i * 8 + 8))
  return gather([], bets, rand).pot
}
