import type { PokerFlick } from '../shared/protocol.ts'
import type { Cue } from './sound.ts'

export type Pose = { x: number; y: number; rot: number }
export type Frame = Pose & { t: number; lift: number; turn?: number; z?: number }

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
  airShare: 0.55,
  airDrag: 0.12,
  lift: 0.05,
  skidTau: 260,
  skidFriction: 0.0005,
  impactSpin: 0.55,
  spinTau: 90,
  spinFriction: 0.0015,
  spin: 0,
  hand: 0,
  wobble: 0.03,
  stepMs: 16,
  minMs: 180,
}

type Options = Partial<typeof TOSS>

const between = (rand: () => number, lo: number, hi: number) => lo + (hi - lo) * rand()
const sign = (rand: () => number) => (rand() < 0.5 ? -1 : 1)

function skidOf(v: number, tau: number, mu: number) {
  const time = tau * Math.log(1 + v / (mu * tau))
  return { time, dist: tau * v - mu * tau * time }
}
const skidAt = (t: number, v: number, tau: number, mu: number) => tau * (v + mu * tau) * (1 - Math.exp(-t / tau)) - mu * tau * t

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

export function slide(from: Pose, to: Pose, rand: () => number, options: Options = {}): Frame[] {
  const o = { ...TOSS, ...options }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.hypot(dx, dy)
  const pushed = o.hand > 0
  const lead = d * (pushed ? o.hand : o.airShare)
  const v1 = Math.max(1e-3, speedFor(d - lead, o.skidTau, o.skidFriction))
  const v0 = pushed ? 0 : v1 / (1 - o.airDrag)
  const leadMs = lead > 0 ? (2 * lead) / (v0 + v1) : 0
  const skid = skidOf(v1, o.skidTau, o.skidFriction)
  const total = Math.max(o.minMs, leadMs + skid.time)

  const w0 = o.spin
  const wLand = w0 * (pushed ? 1 : (1 - o.airDrag) * o.impactSpin)
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

export function pitch(dealer: { x: number; y: number }, spot: Pose, rand: () => number, spin: readonly [number, number] = [0.35, 0.9]): Frame[] {
  const frames = slide({ x: dealer.x, y: dealer.y, rot: spot.rot }, spot, rand, {
    spin: sign(rand) * between(rand, ...spin),
    airShare: between(rand, 0.46, 0.64),
    skidTau: TOSS.skidTau * between(rand, 0.8, 1.2),
  })
  const extra = frames[frames.length - 1].rot - spot.rot
  return frames.map((f) => ({ ...f, rot: f.rot - extra }))
}

export const RECEIVE = {
  scatter: 0.45,
  scatterRot: 22,
  reactMs: [150, 450] as const,
  squareRot: 5,
  tapDepth: [0.012, 0.03] as const,
  tapMs: [55, 90] as const,
  tapGap: [80, 170] as const,
}

export function scatter(neat: Pose, cardW: number, rand: () => number): Pose {
  const angle = between(rand, 0, Math.PI * 2)
  const r = cardW * RECEIVE.scatter * (0.35 + 0.65 * rand())
  return { x: neat.x + Math.cos(angle) * r, y: neat.y + Math.sin(angle) * r, rot: neat.rot + sign(rand) * between(rand, 4, RECEIVE.scatterRot) }
}

export function receive(flight: Frame[], neat: Pose, collectAt: number, rand: () => number): Frame[] {
  const land = flight[flight.length - 1]
  const frames: Frame[] = [...flight]
  const start = Math.max(land.t, collectAt)
  if (start > land.t) frames.push({ ...land, t: start, lift: 0 })
  const near: Pose = { x: neat.x + between(rand, -3, 3), y: neat.y + between(rand, -3, 3), rot: neat.rot + sign(rand) * RECEIVE.squareRot }
  const drawn = slide(land, near, rand, { hand: 0.55, lift: 0, wobble: 0.01, skidTau: 70, skidFriction: 0.003, minMs: 220 })
  for (const f of drawn.slice(1)) frames.push({ ...f, t: f.t + start })
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

export function dealSchedule(seats: number, gap: number, round: number, window: number, rand: () => number): number[] {
  const starts = [0]
  for (let i = 1; i < seats * 2; i++) starts.push(starts[i - 1] + (i === seats ? round : gap) * between(rand, 0.75, 1.25))
  const last = starts[starts.length - 1]
  return last > window ? starts.map((s) => (s * window) / last) : starts
}

export const REVEAL = {
  beatMs: [150, 300] as const,
  turnMs: 360,
  hinge: 0.85,
  afterTurnMs: [60, 140] as const,
  stackIn: [0.1, 0.3] as const,
  stackRot: [3, 9] as const,
  stackStep: [0.05, 0.09] as const,
  stackFan: [0.08, 0.14] as const,
  stackTwist: [1.5, 3.5] as const,
  offSlot: [0.15, 0.35] as const,
  offRot: [4, 12] as const,
  spreadLag: 30,
}

const nudge = (from: Pose, to: Pose, rand: () => number) =>
  slide(from, to, rand, { hand: 0.6, lift: 0, wobble: 0.01, skidTau: 80, skidFriction: 0.003, minMs: 200 })

function turnOver(landedAt: number, rand: () => number) {
  const beat = between(rand, ...REVEAL.beatMs)
  return { turnAt: landedAt + beat, holdMs: beat + REVEAL.turnMs + between(rand, ...REVEAL.afterTurnMs) }
}

function poseAt(frames: Frame[], t: number): Frame {
  const i = frames.findIndex((f) => f.t >= t)
  if (i <= 0) return { ...frames[i < 0 ? frames.length - 1 : 0], t }
  const [a, b] = [frames[i - 1], frames[i]]
  const u = (t - a.t) / (b.t - a.t)
  const mix = (p: number, q: number) => p + (q - p) * u
  return { t, x: mix(a.x, b.x), y: mix(a.y, b.y), rot: mix(a.rot, b.rot), lift: mix(a.lift, b.lift) }
}

function turnedOver(frames: Frame[], at: number, hinge: number): Frame[] {
  const down = hinge > 0.5 ? 180 : -180
  const end = at + REVEAL.turnMs
  const turn = (t: number) => t <= at ? down : t >= end ? 0 : down * (0.5 + 0.5 * Math.cos((Math.PI * (t - at)) / REVEAL.turnMs))
  const samples = Array.from({ length: Math.ceil(REVEAL.turnMs / TOSS.stepMs) }, (_, k) => at + (k + 1) * TOSS.stepMs).filter((t) => t < end)
  const times = [...new Set([...frames.map((f) => f.t), at, ...samples, end])].sort((p, q) => p - q)
  return times.map((t) => ({ ...(frames.find((f) => f.t === t) ?? poseAt(frames, t)), turn: turn(t) }))
}

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
  const touchdown = flight.find((f, i) => i > 0 && f.lift <= 0) ?? flight[flight.length - 1]
  const along = (f: Pose) => (f.x - dealer.x) * fwd.x + (f.y - dealer.y) * fwd.y
  const skidLen = along(stack) - along(touchdown)
  const skidded = (f: Frame) => f.lift > 0 || skidLen <= 0 ? 0 : Math.min(1, Math.max(0, (along(f) - along(touchdown)) / skidLen))
  const frames = slots.map((slot, k) => {
    const o = offsets[slots.length - 1 - k]
    const shift = <P extends Pose>(f: P, fan: number): P => ({ ...f, x: f.x + o.x + fwd.x * fan, y: f.y + o.y + fwd.y * fan, rot: f.rot + o.rot })
    return turnedOver(chain(flight.map((f) => shift(f, o.fan * skidded(f))), holdMs + k * lag, nudge(shift(stack, o.fan), slot, rand)), turnAt, hinge)
      .map((f) => ({ ...f, z: Math.abs(f.turn!) > 90 ? slots.length - k : k + 1 }))
  })
  return { frames, turnAt, hinge }
}

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
    const frames = turnedOver(still, 0, hinge).map((f) => ({ ...f, z: Math.abs(f.turn!) > 90 ? k + 1 : faceDown.length - k }))
    return { frames, rest, hinge }
  })
}

export function street(dealer: { x: number; y: number }, slot: Pose, cardW: number, rand: () => number): { frames: Frame[]; turnAt: number; hinge: number } {
  const angle = between(rand, 0, Math.PI * 2)
  const r = cardW * between(rand, ...REVEAL.offSlot)
  const off: Pose = { x: slot.x + Math.cos(angle) * r, y: slot.y + Math.sin(angle) * r, rot: slot.rot + sign(rand) * between(rand, ...REVEAL.offRot) }
  const flight = pitch(dealer, off, rand)
  const { turnAt, holdMs } = turnOver(flight[flight.length - 1].t, rand)
  const hinge = REVEAL.hinge
  return { frames: turnedOver(chain(flight, holdMs, nudge(off, slot, rand)), turnAt, hinge), turnAt, hinge }
}

export const FOLD = {
  pushBelow: 0.35,
  reachThrown: 0.28125,
  reachFlick: 0.34375,
  reachSoft: 0.25,
  reachTimeout: 0.171875,
  reachVary: 0.25,
  heading: 12,
  bend: 20,
  spinQuiet: 0.55,
  spinWild: [1.3, 2.1] as const,
}

export function toss(from: Pose, aim: { x: number; y: number }, flick: PokerFlick | null, rand: () => number, keepClear = 0, wild = false): { frames: Frame[]; rest: Pose } {
  const thrown = !!flick && flick.speed >= FOLD.pushBelow
  const reach = Math.hypot(aim.x - from.x, aim.y - from.y)
  const angle = ((flick ? flick.dx * FOLD.bend : 0) + between(rand, -FOLD.heading, FOLD.heading)) * (Math.PI / 180)
  const ux = reach ? (aim.x - from.x) / reach : 0
  const uy = reach ? (aim.y - from.y) / reach : -1
  const dirX = ux * Math.cos(angle) - uy * Math.sin(angle)
  const dirY = ux * Math.sin(angle) + uy * Math.cos(angle)
  const wobble = thrown ? 0.02 : 0.01
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
  const air = contacts(frames).air
  const lifted = thrown && air ? frames.map((f) => f.t < air ? { ...f, lift: frames[0].lift * Math.sin((Math.PI * f.t) / air) } : f) : frames
  const last = lifted[lifted.length - 1]
  return { frames: lifted, rest: { x: last.x, y: last.y, rot: last.rot } }
}

export function wildCard(rand: () => number): -1 | 0 | 1 {
  if (rand() >= 0.35) return -1
  return rand() < 0.5 ? 0 : 1
}

export function sweep(from: Pose, pile: Pose): Frame[] {
  return slide(from, pile, () => 0.5, { hand: 0.5, lift: 0, wobble: 0, skidTau: 110 })
}

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

export type PieceSound = Partial<Record<'start' | 'air' | 'tap' | 'flip' | 'stop', Cue>>

export function soundPlan(sound: PieceSound, frames: Frame[]): { cue: Cue; at: number; airMs?: number }[] {
  const at = contacts(frames)
  const out: { cue: Cue; at: number; airMs?: number }[] = []
  if (sound.air && at.air) out.push({ cue: sound.air, at: 0, airMs: at.air })
  const hits: [Cue | undefined, number[]][] = [[sound.start, [0]], [sound.tap, at.tap], [sound.flip, at.flip], [sound.stop, [at.stop]]]
  for (const [cue, times] of hits) if (cue) for (const t of times) out.push({ cue, at: t })
  return out
}

export function chain(a: Frame[], holdMs: number, b: Frame[]): Frame[] {
  const end = a[a.length - 1]
  const at = end.t + holdMs
  return [...a, { ...end, t: at }, ...b.slice(1).map((f) => ({ ...f, t: f.t + at }))]
}

const DENOMINATIONS = [500, 100, 25, 5, 1]
const MAX_CHIPS = 10

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

export type PotStack = { x: number; y: number; chips: number[] }
const around = (count: number, r: number, turn: number) => Array.from({ length: count }, (_, k) => (turn + (k * 360) / count) % 360)
  .sort((a, b) => Math.abs(((a + 180) % 360) - 180) - Math.abs(((b + 180) % 360) - 180))
  .map((deg) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r])
const POT_SPOTS = [[0, 0], ...around(6, 1, 0), ...around(12, 1.95, 15)]
const POT_STACK_MAX = 10

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

export const CHIP_STEP = 0.05
export const CHIP_FACE = 0.9

export function topShades(stacks: { x: number; y: number; n: number }[], lamp: { x: number; y: number }, chipW: number): { x: number; y: number; dx: number; dy: number }[][] {
  return stacks.map((low) => stacks.flatMap((high) => {
    if (high.n <= low.n || !low.n) return []
    const x = high.x - low.x
    const y = high.y - low.y
    const away = Math.hypot(high.x - lamp.x, high.y - lamp.y) || 1
    const run = chipW * CHIP_STEP * (high.n - low.n)
    const dx = ((high.x - lamp.x) / away) * run
    const dy = ((high.y - lamp.y) / away) * run
    const t = Math.max(0, Math.min(1, -(x * dx + y * dy) / (dx * dx + dy * dy || 1)))
    return Math.hypot(x + dx * t, y + dy * t) < chipW ? [{ x, y, dx, dy }] : []
  }))
}

export function potOf(amount: number, rand: () => number): PotStack[] {
  const chips = chipStack(amount, 48)
  const bets = Array.from({ length: Math.ceil(chips.length / 8) }, (_, i) => chips.slice(i * 8, i * 8 + 8))
  return gather([], bets, rand).pot
}
