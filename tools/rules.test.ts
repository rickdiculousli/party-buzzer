import test from 'node:test'
import assert from 'node:assert/strict'
import { whenever, neverFollows, phaseGraph, minGap, check, type Rule } from './rules.ts'
import type { Frame } from '../server/trace.ts'

const frame = (seq: number, cause: string, phase: string, order: unknown[] = [], scores = {}): Frame =>
  ({ seq, t: 1000 + seq * 100, cause, state: { round: { phase, armedAt: 900, order }, players: [], scores, game: { id: 'trivia' } } }) as never

test('whenever flags a frame where must fails', () => {
  const rule = whenever('lock needs a leader',
    (_prev, f) => f.state.round.phase === 'LOCKED',
    (_prev, f) => f.state.round.order.length > 0)
  const ok = [frame(0, 'host:arm', 'ARMED'), frame(1, 'settle', 'LOCKED', [{ playerId: 'a' }])]
  const bad = [frame(0, 'host:arm', 'ARMED'), frame(1, 'settle', 'LOCKED')]
  assert.deepEqual(check(ok, [rule], {}), [])
  const v = check(bad, [rule], {})
  assert.equal(v.length, 1)
  assert.equal(v[0].rule, 'lock needs a leader')
  assert.equal(v[0].seq, 1)
})

test('neverFollows flags an adjacent moment pair', () => {
  // buzz:open immediately followed by idle:ready is a legal-shape pair for
  // the factory test — the real moment pairs live in the RULES table.
  const rule = neverFollows('no ready after open', 'buzz:open', 'idle:ready')
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'host:resetRound', 'IDLE'),
  ]
  // ARMED with armedAt in the past is buzz:open; IDLE with armedAt set is idle:ready.
  const v = check(frames, [rule], {})
  assert.equal(v.length, 1)
  assert.equal(v[0].seq, 1)
})

test('phaseGraph flags an illegal transition and allows legal ones', () => {
  const rule = phaseGraph('phases', {
    IDLE: ['ARMED'], ARMED: ['COLLECTING', 'IDLE'], COLLECTING: ['LOCKED', 'IDLE'], LOCKED: ['IDLE'],
  })
  const ok = [frame(0, 'host:arm', 'ARMED'), frame(1, 'buzz', 'COLLECTING'), frame(2, 'settle', 'LOCKED'), frame(3, 'host:next', 'IDLE')]
  const bad = [frame(0, 'host:arm', 'ARMED'), frame(1, 'settle', 'LOCKED')]
  assert.deepEqual(check(ok, [rule], {}), [])
  assert.equal(check(bad, [rule], {}).length, 1)
})

test('minGap flags a settle that lands early', () => {
  const rule = minGap('full collect window', 'buzz', 'settle', 1000)
  const ok = [frame(0, 'buzz', 'COLLECTING'), { ...frame(1, 'settle', 'LOCKED'), t: 2500 }]
  const early = [frame(0, 'buzz', 'COLLECTING'), { ...frame(1, 'settle', 'LOCKED'), t: 1500 }]
  assert.deepEqual(check(ok, [rule], {}), [])
  const v = check(early, [rule], {})
  assert.equal(v.length, 1)
  assert.match(v[0].detail, /500/)
})

test('check runs every rule and returns every violation', () => {
  const rules: Rule[] = [
    whenever('a', () => true, () => false),
    whenever('b', () => true, () => false),
  ]
  const v = check([frame(0, 'x', 'IDLE'), frame(1, 'y', 'IDLE')], rules, {})
  assert.equal(v.length, 4)
})
