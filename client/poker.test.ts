import test from 'node:test'
import assert from 'node:assert/strict'
import type { PokerFeedEntry } from '../shared/protocol.ts'
import { classifyGesture, pokerCues, seatPositions, ELLIPSE, type PokerView, type TracePoint } from './poker.ts'

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

const seat = (player: string) => ({ player, stack: 1000, bet: 0, button: false, sb: false, bb: false, folded: false, allIn: false, busted: false, away: false, cards: null })
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

test('the last seconds of your clock tick', () => {
  const before = view({ actBy: 15_500, serverTime: 10_000 })
  const after = view({ actBy: 15_500, serverTime: 11_000 })
  assert.deepEqual(pokerCues(before, after, 'a'), [{ cue: 'poker-tick' }])
  assert.deepEqual(pokerCues(before, after, 'b'), [])
})

test('a first frame or another match only sets the baseline', () => {
  const after = view({ board: ['As', 'Kd', '2c'] })
  assert.deepEqual(pokerCues(null, after, 'board'), [])
  assert.deepEqual(pokerCues({ ...view(), matchId: 'old' }, after, 'board'), [])
})
