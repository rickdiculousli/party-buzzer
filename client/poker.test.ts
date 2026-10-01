import test from 'node:test'
import assert from 'node:assert/strict'
import type { PokerFeedEntry, PokerSeatView } from '../shared/protocol.ts'
import { classifyGesture, dealTimes, peekTip, peelCard, bendCard, pokerClockCue, pokerCues, raiseStops, seatPositions, ELLIPSE, type PokerView, type TracePoint } from './poker.ts'

/** A straight trace from (0,0) to (dx,dy) over ms, one point every 10 ms. */
function line(dx: number, dy: number, ms: number, t0 = 0): TracePoint[] {
  const steps = Math.max(1, Math.round(ms / 10))
  return Array.from({ length: steps + 1 }, (_, i) => ({ x: (dx * i) / steps, y: (dy * i) / steps, t: t0 + (ms * i) / steps }))
}

test('a short still touch is a tap; moving past the slop is not', () => {
  assert.equal(classifyGesture(line(9, 0, 150), null).kind, 'tap')
  assert.equal(classifyGesture(line(11, 0, 150), null).kind, 'none')
})

test('a second tap within the gap is a double tap', () => {
  assert.equal(classifyGesture(line(0, 0, 100, 1_299), 1_000).kind, 'doubleTap')
  assert.equal(classifyGesture(line(0, 0, 100, 1_301), 1_000).kind, 'tap')
})

test('a fast upward release is a flick with its direction and speed', () => {
  const flick = classifyGesture(line(0, -70, 70), null)
  assert.equal(flick.kind, 'flick')
  assert.ok(flick.flick!.dy < 0)
  assert.equal(flick.flick!.dx, 0)
  assert.ok(flick.flick!.speed > 0 && flick.flick!.speed <= 1)
  assert.equal(classifyGesture(line(0, -50, 40), null).kind, 'none', 'too short')
  assert.equal(classifyGesture(line(0, 90, 60), null).kind, 'none', 'downward')
  assert.equal(classifyGesture(line(0, -90, 600), null).kind, 'none', 'too slow')
})

test('a still touch held past the press delay is a press', () => {
  assert.equal(classifyGesture(line(2, 2, 200), null).kind, 'press')
})

test('seats sit on the ellipse, the first at bottom centre', () => {
  assert.deepEqual(seatPositions(1)[0], { x: ELLIPSE.cx, y: ELLIPSE.cy + ELLIPSE.ry })
  for (const { x, y } of seatPositions(7)) {
    const r = ((x - ELLIPSE.cx) / ELLIPSE.rx) ** 2 + ((y - ELLIPSE.cy) / ELLIPSE.ry) ** 2
    assert.ok(Math.abs(r - 1) < 1e-9)
  }
  // Clockwise on screen: the second seat is left of the first.
  assert.ok(seatPositions(4)[1].x < seatPositions(4)[0].x)
})

const seat = (player: string) => ({ player, stack: 1000, bet: 0, button: false, sb: false, bb: false, folded: false, allIn: false, busted: false, place: null, away: false, cards: null })
function view(over: Partial<PokerView> = {}, feed: Omit<PokerFeedEntry, 'id'>[] = []): PokerView {
  return {
    matchId: 'm', serverTime: 10_000,
    phase: 'bet', street: 'preflop', seats: [seat('a'), seat('b')], board: [], pots: [], actor: 'a', actBy: 40_000,
    handNo: 1, sb: 10, bb: 20, nextLevelAt: 600_000, equity: null, runout: false, showdown: null,
    feed: feed.map((entry, i) => ({ id: i + 1, ...entry })), reactions: [],
    ...over,
  }
}

test('the flop plays once, on the board only', () => {
  const before = view()
  const after = view({ board: ['As', 'Kd', '2c'], street: 'flop' })
  assert.deepEqual(pokerCues(before, after, 'board'), [{ cue: 'poker-flop' }])
  assert.deepEqual(pokerCues(before, after, 'a'), [])
  assert.deepEqual(pokerCues(after, after, 'board'), [])
})

test('your turn plays only on your phone', () => {
  const before = view({ actor: 'b' })
  const after = view({ actor: 'a' })
  assert.deepEqual(pokerCues(before, after, 'a'), [{ cue: 'poker-yours' }])
  assert.deepEqual(pokerCues(before, after, 'b'), [])
  assert.deepEqual(pokerCues(before, after, 'board'), [])
})

test('feed entries play their cue once; an auto fold plays on that phone', () => {
  const before = view()
  const after = view({}, [{ player: 'a', kind: 'fold', auto: true }, { player: 'b', kind: 'check' }, { player: 'b', kind: 'raise', amount: 60 }])
  assert.deepEqual(pokerCues(before, after, 'board'), [{ cue: 'poker-check' }, { cue: 'poker-chips' }])
  assert.deepEqual(pokerCues(before, after, 'a'), [{ cue: 'poker-auto' }])
  assert.deepEqual(pokerCues(after, after, 'board'), [])
})

test('local countdown ticks once per changed second, never on mount or zero', () => {
  assert.equal(pokerClockCue(null, 4), null)
  assert.equal(pokerClockCue(7, 6), null)
  assert.equal(pokerClockCue(6, 5), 'poker-tick')
  assert.equal(pokerClockCue(5, 5), null)
  assert.equal(pokerClockCue(5, 4), 'poker-tick')
  assert.equal(pokerClockCue(1, 0), null)
  assert.equal(pokerClockCue(4, 5), null)
  assert.deepEqual(pokerCues(view({ serverTime: 10_000 }), view({ serverTime: 11_000 }), 'a'), [])
})

test('a first frame or another match only sets the baseline', () => {
  const after = view({ board: ['As', 'Kd', '2c'] })
  assert.deepEqual(pokerCues(null, after, 'board'), [])
  assert.deepEqual(pokerCues({ ...view(), matchId: 'old' }, after, 'board'), [])
})

test('dealTimes deals clockwise from left of the button, skipping busted seats, then goes round again', () => {
  const seat = (button: boolean, busted = false) => ({ button, busted }) as PokerSeatView
  const times = dealTimes([seat(false), seat(true), seat(false, true), seat(false)], 7)
  assert.deepEqual([...times.keys()], [3, 0, 1])
  const firsts = [...times.values()].map(([a]) => a)
  const seconds = [...times.values()].map(([, b]) => b)
  assert.equal(firsts[0], 0)
  assert.ok(firsts.every((t, i) => i === 0 || t > firsts[i - 1]))
  assert.ok(seconds[0] > firsts[2] && seconds.every((t, i) => i === 0 || t > seconds[i - 1]))
  assert.deepEqual(dealTimes([seat(false), seat(true), seat(false, true), seat(false)], 7), times)
})

test('peelCard lands the corner on the finger and splits the card along the fold', () => {
  const [w, h] = [100, 140]
  const apply = (m: readonly number[], p: { x: number; y: number }) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })
  const close = (a: { x: number; y: number }, b: { x: number; y: number }) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-6, `${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`)
  const peel = peelCard(w, h, { x: 0, y: h }, { x: 30, y: 110 })!
  // The corner, seen on the face, is carried onto the finger.
  close(apply(peel.matrix, { x: w, y: h }), { x: 30, y: 110 })
  // Every flap point lands on the flat side of the fold: it is turned over, not slid.
  const area = (ps: { x: number; y: number }[]) => Math.abs(ps.reduce((a, p, i) => a + p.x * ps[(i + 1) % ps.length].y - ps[(i + 1) % ps.length].x * p.y, 0)) / 2
  assert.ok(Math.abs(area(peel.flat) + area(peel.lifted) - w * h) < 1e-6)
  assert.equal(peel.lifted.length, 3)
  // Out of reach, the tip stops short along the same line.
  const far = peelCard(w, h, { x: w, y: h }, { x: w - 300, y: h - 400 })!
  assert.ok(Math.abs(Math.hypot(far.tip.x - w, far.tip.y - h) - 120) < 1e-6)
  // Pulled straight up, the bottom edge bends up as a band across the card.
  assert.equal(peelCard(w, h, { x: 0, y: h }, { x: 0, y: h - 60 })!.lifted.length, 4)
  assert.equal(peelCard(w, h, { x: 0, y: h }, { x: 0.2, y: h }), null)
})

test('peekTip levers the finger rise and locks the lean up and to the left', () => {
  const p = { line: 0.25, lever: 3, tilt: 10, flex: 2, reach: 1, liftMs: 0, dropMs: 0 }
  const corner = { x: 0, y: 300 }
  const from = { x: 50, y: 350 }
  const lean = (tip: { x: number; y: number }) => Math.atan2(tip.x - corner.x, corner.y - tip.y) * 180 / Math.PI
  // Straight up 20 px lifts the edge 60, leaning as near upright as the lock allows.
  const up = peekTip(corner, from, { x: 50, y: 330 }, 100, p)!
  assert.ok(Math.abs(up.y - 240) < 1e-9 && Math.abs(lean(up) + 8) < 1e-9)
  // Right or far left, the lean stays inside its two degrees.
  assert.ok(Math.abs(lean(peekTip(corner, from, { x: 150, y: 330 }, 100, p)!) + 8) < 1e-9)
  assert.ok(Math.abs(lean(peekTip(corner, from, { x: -150, y: 330 }, 100, p)!) + 10) < 1e-9)
  // No rise bends nothing; a long pull stops at reach.
  assert.equal(peekTip(corner, from, { x: 80, y: 352 }, 100, p), null)
  assert.ok(Math.abs(peekTip(corner, from, { x: 50, y: 0 }, 100, p)!.y - 200) < 1e-9)
})

test('raise stops run min and the standard sizes short of all in', () => {
  // Pot 300 after the 100 call, facing a bet of 100: 1/2 pot is 100 + 150. 1/3 pot is the minimum itself.
  const stops = raiseStops({ minTo: 200, maxTo: 1000, highBet: 100, pot: 200, call: 100, sb: 10, bb: 20, unopened: false })
  assert.deepEqual(stops.map((s) => s.label), ['Min', '1/2 pot', '2/3 pot', '3/4 pot', 'Pot', '1.5× pot', '2× pot'])
  assert.deepEqual(stops.map((s) => s.to), [200, 250, 300, 330, 400, 550, 700])
  // An unopened pot preflop opens in big blinds.
  const open = raiseStops({ minTo: 40, maxTo: 1500, highBet: 20, pot: 30, call: 20, sb: 10, bb: 20, unopened: true })
  assert.deepEqual(open.map((s) => s.to), [40, 50, 60, 80, 100])
})


test('bent peek stays finite from a tiny lift through the maximum pull, at either card tilt', () => {
  for (const rot of [0, -24]) for (const rise of [1.1, 5, 40, 120, 250]) {
    const bend = bendCard(120, 168, { x: 100, y: 168 }, { x: 100 - rise * 0.2, y: 168 - rise }, rot)!
    assert.equal(bend.strips.length, 8)
    assert.ok(bend.strips.every((s) => s.matrix.every(Number.isFinite)))
    assert.ok(bend.shade.stops.every(({ at, light }) => Number.isFinite(at) && Number.isFinite(light)))
    assert.ok(bend.shadow.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
    assert.ok(bend.strips.some((s) => s.back))
    assert.ok(bend.strips.some((s) => !s.back))
    assert.ok(bend.opacity >= 0 && bend.opacity <= 0.34)
  }
  assert.equal(bendCard(120, 168, { x: 100, y: 168 }, { x: 100, y: 168 }), null)
})

test('adjacent bend strips meet at their shared material boundary', () => {
  const bend = bendCard(120, 168, { x: 100, y: 168 }, { x: 80, y: 68 })!
  // The overlap clips enclose each boundary; projected positions must agree there.
  const nx = -20 / Math.hypot(20, 100), ny = -100 / Math.hypot(20, 100)
  const mid = { x: 90, y: 118 }
  const at = (m: number[], x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] })
  for (let i = 1; i < bend.strips.length; i++) {
    const s = bend.strips[i].fromDepth
    const x = 120 - mid.x + nx * s, y = mid.y - ny * s
    const a = at(bend.strips[i - 1].matrix, x, y), b = at(bend.strips[i].matrix, x, y)
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-8)
  }
})


test('stacked peeks share the bend despite different exposed card depths', () => {
  const profile = { depth: 80, length: 36 }
  const a = bendCard(120, 168, { x: 100, y: 168 }, { x: 100, y: 68 }, 0, Infinity, profile)!
  const b = bendCard(120, 148, { x: 100, y: 148 }, { x: 100, y: 88 }, 0, Infinity, profile)!
  // Both folds lie on y=118; source depth and bend position are therefore identical.
  a.strips.forEach((strip, i) => {
    assert.deepEqual(strip.matrix, b.strips[i].matrix)
    assert.equal(strip.back, b.strips[i].back)
  })
  assert.deepEqual(a.shade.stops.map((s) => s.light), b.shade.stops.map((s) => s.light))
})

test('tilted cards project the shared bend onto the same screen surface', () => {
  const profile = { depth: 90, length: 36 }
  const rotate = (p: { x: number; y: number }, degrees: number) => {
    const a = degrees * Math.PI / 180
    return { x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) }
  }
  const corner = { x: 85, y: 165 }, finger = { x: 65, y: 65 }
  const bends = [0, -24].map((rot) => bendCard(120, 168, rotate(corner, -rot), rotate(finger, -rot), rot, Infinity, profile)!)
  for (let i = 0; i < bends[0].strips.length; i++) {
    const p = { x: 70, y: 120 + i * 2 }
    const projected = [0, -24].map((rot, k) => {
      const local = rotate(p, -rot), x = 120 - local.x, y = local.y
      const m = bends[k].strips[i].matrix
      return rotate({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }, rot)
    })
    assert.ok(Math.hypot(projected[0].x - projected[1].x, projected[0].y - projected[1].y) < 1e-8)
  }
})

test('peek samples show the side facing the screen after elevation projection', () => {
  for (const rot of [0, -24]) {
    const bend = bendCard(120, 168, { x: 100, y: 168 }, { x: 80, y: 68 }, rot)!
    for (const strip of bend.strips) {
      const [a, b, c, d] = strip.matrix
      // Source face coordinates are mirrored: a negative determinant exposes the back.
      assert.equal(strip.back, a * d - b * c < 0)
    }
  }
})


test('bend starts nearly tangent to the flat underside and spends its samples on the curve', () => {
  const bend = bendCard(120, 168, { x: 100, y: 168 }, { x: 100, y: 68 })!
  const first = bend.strips[0]
  assert.ok(Math.abs(first.matrix[3] - 1) < 0.001)
  assert.ok(first.toDepth < 1)
  assert.ok(Math.abs(Math.min(...first.clip.map((p) => p.y - 118)) + 0.65) < 1e-8)
  const last = bend.strips.at(-1)!
  assert.ok(last.toDepth - last.fromDepth > 10)
  assert.deepEqual(bend.flat, peelCard(120, 168, { x: 100, y: 168 }, { x: 100, y: 68 })!.flat)
})
