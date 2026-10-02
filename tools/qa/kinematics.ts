/**
 * Motion as numbers, for a critic who cannot watch it.
 *
 *   node tools/qa/kinematics.ts            # every preset, 12 seeds each
 *   node tools/qa/kinematics.ts deal fold  # presets whose name contains a word
 *
 * Runs the real path generators in `client/toss.ts` with fixed seeds and
 * reports each move in card widths (cw), so numbers compare with a real table:
 * a poker card is 6.3cm wide, so 1 m/s is about 16 cw/s. It also flags shapes
 * that real objects do not make (see `violations`). A flag is a lead, not a
 * verdict: a hand may legitimately push, and a clamp may be intended.
 *
 * ponytail: presets cover Poker's moves only. Add a preset when another game
 * builds motion from frame lists.
 */
import { mulberry32 } from '../../shared/random.ts'
import { flop, pitch, receive, scatter, slide, street, sweep, toss, turnUp, type Frame, type Pose } from '../../client/toss.ts'

/** The board's card at 1920 × 1080, as `PokerBoard` sizes it. */
const CW = 88
const DEALER = { x: 845, y: -CW * 1.6 }
const SEAT_BOTTOM: Pose = { x: 845, y: 820, rot: 0 }
const SEAT_SIDE: Pose = { x: 290, y: 540, rot: 12 }
const MIDDLE = { x: 845, y: 540 }
const SLOTS: Pose[] = [0, 1, 2, 3, 4].map((i) => ({ x: 845 + (i - 2) * CW * 1.14, y: 540, rot: 0 }))

type Preset = { name: string; note: string; make: (seed: number) => Frame[] }
const PRESETS: Preset[] = [
  { name: 'deal-pitch-near', note: 'dealer to the bottom seat, landing loose', make: (s) => pitch(DEALER, scatter(SEAT_BOTTOM, CW, mulberry32(s + 100)), mulberry32(s)) },
  { name: 'deal-pitch-far', note: 'dealer to a side seat', make: (s) => pitch(DEALER, scatter(SEAT_SIDE, CW, mulberry32(s + 100)), mulberry32(s)) },
  { name: 'deal-receive', note: 'pitched, lies loose, gathered and tapped square', make: (s) => {
    const flight = pitch(DEALER, scatter(SEAT_BOTTOM, CW, mulberry32(s + 100)), mulberry32(s))
    return receive(flight, SEAT_BOTTOM, flight[flight.length - 1].t + 300, mulberry32(s + 200))
  } },
  { name: 'flop-top-card', note: 'the flop stack pitched, turned over, spread (last card)', make: (s) => flop(DEALER, SLOTS.slice(0, 3), CW, mulberry32(s)).frames[2] },
  { name: 'street', note: 'turn or river: pitched, turned over, drawn into line', make: (s) => street(DEALER, SLOTS[3], CW, mulberry32(s)).frames },
  { name: 'showdown-turn', note: 'a shown pair turned over in place', make: () => turnUp([SEAT_SIDE, { ...SEAT_SIDE, x: SEAT_SIDE.x + 12 }], MIDDLE, CW)[0].frames },
  { name: 'fold-thrown-hard', note: 'full-speed flick', make: (s) => toss(SEAT_BOTTOM, MIDDLE, { dx: 0.1, dy: -1, speed: 1 }, mulberry32(s), CW * 1.6).frames },
  { name: 'fold-thrown-soft', note: 'just over the throw threshold', make: (s) => toss(SEAT_BOTTOM, MIDDLE, { dx: 0, dy: -1, speed: 0.4 }, mulberry32(s), CW * 1.6).frames },
  { name: 'fold-pushed', note: 'soft flick: pushed along the cloth', make: (s) => toss(SEAT_BOTTOM, MIDDLE, { dx: 0, dy: -1, speed: 0.2 }, mulberry32(s), CW * 1.6).frames },
  { name: 'fold-timeout', note: 'no flick: nudged', make: (s) => toss(SEAT_BOTTOM, MIDDLE, null, mulberry32(s), CW * 1.6).frames },
  { name: 'bet-slide', note: 'chips pushed from the seat to the bet line', make: (s) => slide({ x: 845, y: 900, rot: 0 }, { x: 845, y: 700, rot: 0 }, mulberry32(s), { hand: 0.4, lift: 0, wobble: 0.02 }) },
  { name: 'sweep', note: 'a bet drawn into the pot', make: () => sweep({ x: 845, y: 700, rot: 0 }, { x: 845 + CW * 3.8, y: 540, rot: 0 }) },
  { name: 'pot-push', note: 'the pot pushed to a winner', make: (s) => slide({ x: 845 + CW * 3.8, y: 540, rot: 0 }, { x: 845, y: 700, rot: 0 }, mulberry32(s), { hand: 0.35, lift: 0, wobble: 0.03, skidTau: 200 }) },
]

type Step = { t: number; dt: number; v: number; w: number; lift: number; turn?: number; z?: number }
const stepsOf = (frames: Frame[]): Step[] => frames.slice(1).map((f, i) => {
  const a = frames[i]
  const dt = Math.max(1e-6, f.t - a.t)
  return { t: f.t, dt, v: Math.hypot(f.x - a.x, f.y - a.y) / dt, w: (f.rot - a.rot) / dt, lift: f.lift, turn: f.turn, z: f.z }
})

/** Shapes a thrown or pushed object does not make, each with when it happens. */
export function violations(frames: Frame[], cw = CW): { t: number; kind: string; detail: string }[] {
  const out: { t: number; kind: string; detail: string }[] = []
  const steps = stepsOf(frames)
  const still = cw * 0.02 / 16
  let peak = 0
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i], p = steps[i - 1]
    if (s.v < still) { peak = 0; continue }
    // Speed that came back after falling a fifth from its peak, with no stop between: a second push from nowhere.
    if (p && s.v > p.v * 1.05 && p.v < peak * 0.8 && s.dt >= 8) out.push({ t: s.t, kind: 're-accelerates', detail: `${(p.v * 1000 / cw).toFixed(1)} → ${(s.v * 1000 / cw).toFixed(1)} cw/s after peaking at ${(peak * 1000 / cw).toFixed(1)}` })
    // A step far faster than both neighbours: a jump, or a clamp landing the last frame.
    const n = steps[i + 1]
    if (p && s.v > 2.5 * Math.max(p.v, n?.v ?? 0, still) && s.v * s.dt > cw * 0.03) out.push({ t: s.t, kind: 'jump', detail: `${(s.v * s.dt / cw).toFixed(2)} cw in one ${s.dt.toFixed(0)}ms step (neighbours ${(p.v * 1000 / cw).toFixed(1)} / ${((n?.v ?? 0) * 1000 / cw).toFixed(1)} cw/s)` })
    // Spin that grows while airborne: nothing is pushing it.
    if (p && s.lift > 0 && p.lift > 0 && Math.abs(s.w) > Math.abs(p.w) * 1.1 + 0.01) out.push({ t: s.t, kind: 'spins up in the air', detail: `${(p.w * 1000).toFixed(0)} → ${(s.w * 1000).toFixed(0)} °/s` })
    peak = Math.max(peak, s.v)
    if (Math.abs(s.w * s.dt) > 40) out.push({ t: s.t, kind: 'rotation jump', detail: `${(s.w * s.dt).toFixed(0)}° in one ${s.dt.toFixed(0)}ms step` })
    if (p && s.z !== undefined && p.z !== undefined && s.z !== p.z && s.lift > 0 && p.lift > 0) out.push({ t: s.t, kind: 'restacks mid-air', detail: `z ${p.z} → ${s.z}` })
  }
  return out
}

/** One move's numbers, in card widths and seconds. */
export function summary(frames: Frame[], cw = CW) {
  const steps = stepsOf(frames)
  const touchdown = frames.findIndex((f, i) => i > 0 && frames[i - 1].lift > 0 && f.lift <= 0)
  const air = touchdown > 0 ? frames[touchdown].t : 0
  const moving = steps.filter((s) => s.v > cw * 0.02 / 16)
  const settle = moving.length ? moving[moving.length - 1].t : 0
  const path = steps.reduce((a, s) => a + s.v * s.dt, 0) / cw
  const at = (t: number) => steps.find((s) => s.t >= t) ?? steps[steps.length - 1]
  const turns = steps.filter((s) => s.turn !== undefined && Math.abs(s.turn) > 0 && Math.abs(s.turn) < 180)
  return {
    durationMs: frames[frames.length - 1].t,
    airMs: air,
    settleMs: settle,
    pathCw: path,
    peakCwPerS: Math.max(0, ...steps.map((s) => s.v)) * 1000 / cw,
    releaseCwPerS: (steps[0]?.v ?? 0) * 1000 / cw,
    touchdownCwPerS: air ? at(air).v * 1000 / cw : null,
    peakSpinDegPerS: Math.max(0, ...steps.map((s) => Math.abs(s.w))) * 1000,
    spinAtTouchdownDegPerS: air ? Math.abs(at(air).w) * 1000 : null,
    totalTurnDeg: Math.abs(frames[frames.length - 1].rot - frames[0].rot),
    maxLift: Math.max(...frames.map((f) => f.lift)),
    turnOverMs: turns.length ? turns[turns.length - 1].t - turns[0].t + turns[0].dt : null,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const words = process.argv.slice(2)
  const pick = PRESETS.filter((p) => !words.length || words.some((w) => p.name.includes(w)))
  const fmt = (v: number | null) => v === null ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)
  for (const preset of pick) {
    const runs = Array.from({ length: 12 }, (_, s) => preset.make(s + 1))
    const sums = runs.map((f) => summary(f))
    console.log(`\n## ${preset.name} — ${preset.note}`)
    for (const key of Object.keys(sums[0]) as (keyof (typeof sums)[0])[]) {
      const vals = sums.map((x) => x[key]).filter((v): v is number => v !== null)
      if (!vals.length) continue
      vals.sort((a, b) => a - b)
      console.log(`  ${key.padEnd(24)} min ${fmt(vals[0]).padStart(7)}  median ${fmt(vals[vals.length >> 1]).padStart(7)}  max ${fmt(vals[vals.length - 1]).padStart(7)}`)
    }
    const flags = runs.flatMap((f, s) => violations(f).map((v) => ({ ...v, seed: s + 1 })))
    const byKind = new Map<string, typeof flags>()
    for (const f of flags) byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f])
    if (!byKind.size) console.log('  flags: none')
    for (const [kind, list] of byKind) console.log(`  FLAG ${kind}: ${list.length} in ${new Set(list.map((f) => f.seed)).size}/12 seeds, e.g. seed ${list[0].seed} at ${list[0].t.toFixed(0)}ms: ${list[0].detail}`)
  }
}
