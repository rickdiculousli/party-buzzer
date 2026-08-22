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
