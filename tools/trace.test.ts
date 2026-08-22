import test from 'node:test'
import assert from 'node:assert/strict'
import { momentOf } from '../shared/wall.ts'
import { flatten, diffStates, timelineLine, momentOfFrame, type Change } from './trace.ts'

test('flatten reaches leaves, arrays indexed', () => {
  const m = flatten({ round: { phase: 'ARMED', order: [{ playerId: 'ada', deltaMs: 0 }] }, scores: { ada: 200 } })
  assert.equal(m.get('round.phase'), '"ARMED"')
  assert.equal(m.get('round.order.0.playerId'), '"ada"')
  assert.equal(m.get('scores.ada'), '200')
})

test('diffStates reports changed, added, removed leaves', () => {
  const a = { round: { phase: 'ARMED', order: [] }, players: [{ id: 'a', connected: true }] }
  const b = { round: { phase: 'COLLECTING', order: [{ playerId: 'a' }] }, players: [{ id: 'a', connected: false }], duel: { rule: 'vote' } }
  const d = diffStates(a as never, b as never)
  const by = Object.fromEntries(d.map((c) => [c.path, c]))
  assert.deepEqual(by['round.phase'], { path: 'round.phase', from: '"ARMED"', to: '"COLLECTING"' })
  assert.equal(by['players.0.connected'].to, 'false')
  assert.equal(by['duel.rule'].from, undefined)
  assert.equal(by['duel.rule'].to, '"vote"')
})

test('timelineLine shows seq, delta, cause, phase, moment, diff', () => {
  const prev = { seq: 0, t: 1000, cause: 'host:arm', state: { round: { phase: 'ARMED', armedAt: 900, order: [] }, players: [], scores: {}, game: { id: 'trivia' } } }
  const cur = { seq: 1, t: 1400, cause: 'buzz', state: { ...prev.state, round: { ...prev.state.round, phase: 'COLLECTING', order: [{ playerId: 'ada', name: 'Ada', at: 1400, deltaMs: 0 }] } } }
  const line = timelineLine(cur as never, prev as never)
  const expected = momentOf(cur.state as never, { open: true, settled: false, retired: false })
  assert.match(line, new RegExp(`^#1 \\+400ms buzz COLLECTING ${expected}`))
  assert.match(line, /round\.phase: "ARMED"→"COLLECTING"/)
})

import { filterFrames, roundLines } from './trace.ts'
import type { Frame } from '../server/trace.ts'

const frame = (seq: number, cause: string, phase: string, order: unknown[] = [], scores = {}): Frame =>
  ({ seq, t: 1000 + seq * 100, cause, state: { round: { phase, armedAt: 900, order }, players: [], scores, game: { id: 'trivia' } } }) as never

test('filterFrames applies since/until and watch', () => {
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'buzz', 'COLLECTING', [{ playerId: 'ada' }]),
    frame(2, 'settle', 'LOCKED', [{ playerId: 'ada' }], { ada: 0 }),
  ]
  assert.deepEqual(filterFrames(frames, { since: 1 }).map((f) => f.seq), [1, 2])
  assert.deepEqual(filterFrames(frames, { until: 1 }).map((f) => f.seq), [0, 1])
  // watch keeps only frames where that leaf moved
  assert.deepEqual(filterFrames(frames, { watch: ['scores.ada'] }).map((f) => f.seq), [2])
  assert.deepEqual(filterFrames(frames, { watch: ['round.phase'] }).map((f) => f.seq), [1, 2])
})

test('roundLines collapses a buzzed round to one line', () => {
  const frames = [
    frame(0, 'host:arm', 'ARMED'),
    frame(1, 'buzz', 'COLLECTING', [{ playerId: 'ada', name: 'Ada', deltaMs: 0 }]),
    frame(2, 'settle', 'LOCKED', [{ playerId: 'ada', name: 'Ada', deltaMs: 0 }], { ada: 0 }),
    frame(3, 'host:correct', 'LOCKED', [{ playerId: 'ada', name: 'Ada', deltaMs: 0 }], { ada: 400 }),
    frame(4, 'host:next', 'IDLE'),
  ]
  const lines = roundLines(frames)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /Ada@0/)
  assert.match(lines[0], /correct.*\+400/)
})

test('roundLines marks an unbuzzed round as passed', () => {
  const frames = [frame(0, 'host:arm', 'ARMED'), frame(1, 'host:next', 'IDLE')]
  assert.match(roundLines(frames)[0], /passed/)
})
