import test from 'node:test'
import assert from 'node:assert/strict'
import type { Player, Team } from '../../../shared/protocol.ts'
import type { MinigameRoom } from '../definition.ts'
import { BEAT_MS, createTugWorld, pull, splitSides, stepTug, TUG_STEP_MS, tugFinished, tugPresence, tugResults, type TugWorld } from './world.ts'

const players = (...names: string[]): Player[] => names.map((id) => ({ id, name: id, connected: true }))
const solo = (names: string[], scores: Record<string, number> = {}): MinigameRoom =>
  ({ grouping: 'solo', players: players(...names), teams: [], scores })

function world(names = ['a', 'b', 'c', 'd'], extra: Partial<{ durationSec: number; value: number; room: MinigameRoom }> = {}) {
  const room = extra.room ?? solo(names)
  const w = createTugWorld({ participants: [...names].sort(), room, durationSec: extra.durationSec ?? 30, value: extra.value ?? 100 })
  stepTug(w) // past the countdown guard
  return w
}

/** Steps for `ms`, letting `tapper(id, ms)` decide who taps in each step. */
function run(w: TugWorld, ms: number, tapper: (id: string, at: number) => boolean) {
  for (let t = 0; t < ms && w.endedAtMs === undefined; t += TUG_STEP_MS) {
    for (const id of Object.keys(w.pullers)) if (tapper(id, w.nowMs)) pull(w, id)
    stepTug(w)
  }
}

/** The pull one player banks from a schedule of tap times; their opponent matches them so the rope stays in play. */
function banked(times: number[]) {
  const w = world(['a', 'b'])
  for (const at of times) {
    while (w.nowMs < at) stepTug(w)
    pull(w, 'a')
    pull(w, 'b')
  }
  return w.pullers.a.pull
}

test('taps diminish inside the fatigue window and recover after it', () => {
  const w = world(['a', 'b'])
  pull(w, 'a')
  assert.equal(w.pullers.a.pull, 1)
  pull(w, 'a')
  assert.equal(w.pullers.a.pull, 1.5, 'a second tap at once is worth half')
  for (let i = 0; i < 40; i++) stepTug(w)
  const before = w.pullers.a.pull
  pull(w, 'a')
  assert.ok(w.pullers.a.pull - before > 0.99, 'two seconds on, a tap is nearly fresh')
})

test('mashing pays, but an even rhythm beats bursts of the same taps', () => {
  const every = (ms: number, count: number) => Array.from({ length: count }, (_, i) => 50 + i * ms)
  const slow = banked(every(300, 10)), fast = banked(every(100, 30))
  assert.ok(fast > slow, `three times the taps pulls more (${fast} > ${slow})`)
  assert.ok(fast < slow * 2, 'but nowhere near three times as much')
  const even = banked(every(200, 10))
  const bursts = banked([0, 1, 2, 3, 4].flatMap((i) => [50 + i * 400, 50 + i * 400]))
  assert.ok(even > bursts, `ten even taps (${even}) beat five doubled taps (${bursts})`)
})

test('the spring sags a lead back toward the centre', () => {
  const w = world(['a', 'b'])
  run(w, 800, (id) => id === 'b')
  const out = w.flag
  assert.ok(out > 0.2 && out < 1, `one side pulling moves the flag toward its mark (${out})`)
  run(w, 3000, () => false)
  assert.ok(w.flag > 0 && w.flag < out * 0.8, `left alone it sags back (${w.flag})`)
})

test('a lead can be clawed back', () => {
  const w = world(['a', 'b'])
  run(w, 800, (id) => id === 'b')
  assert.ok(w.flag > 0.2 && w.flag < 1)
  run(w, 6000, (id, at) => id === 'a' || (id === 'b' && at % 300 === 0))
  assert.ok(w.flag < 0, `the other side drags it back past the centre (${w.flag})`)
})

test('the first side past its mark wins at once and the beat holds before the end', () => {
  const w = world(['a', 'b', 'c', 'd'], { value: 150 })
  const side1 = new Set(w.sides[1].members)
  run(w, 30_000, (id) => side1.has(id))
  assert.equal(w.winner, 1)
  assert.equal(w.flag, 1)
  assert.ok(w.endedAtMs! < 10_000, 'flat-out against nobody takes seconds')
  const flag = w.flag
  pull(w, w.sides[0].members[0])
  stepTug(w)
  assert.equal(w.flag, flag, 'nothing moves after the win')
  assert.equal(tugFinished(w), false)
  while (w.nowMs < w.endedAtMs! + BEAT_MS) stepTug(w)
  assert.equal(tugFinished(w), true)
  const results = tugResults(w)
  for (const id of w.sides[1].members) assert.equal(results.find((r) => r.playerId === id)!.points, 150)
  for (const id of w.sides[0].members) assert.equal(results.find((r) => r.playerId === id)!.points, 0)
})

test('at time the side ahead wins, and a dead centre is a draw', () => {
  const w = world(['a', 'b'], { durationSec: 10 })
  run(w, 20_000, (id, at) => id === w.sides[0].members[0] && at % 1000 === 0)
  assert.equal(w.endedAtMs, 10_000)
  assert.equal(w.winner, 0)
  assert.ok(w.flag < 0 && w.flag > -1, 'a gentle pull wins on time, short of the mark')

  const still = world(['a', 'b'], { durationSec: 10 })
  run(still, 20_000, () => false)
  assert.equal(still.winner, null)
  assert.ok(tugResults(still).every((r) => r.points === 0))
})

test('taps before the first step are the countdown and do nothing', () => {
  const w = createTugWorld({ participants: ['a', 'b'], room: solo(['a', 'b']), durationSec: 30, value: 100 })
  assert.equal(pull(w, 'a'), false)
  stepTug(w)
  assert.equal(w.flag, 0)
})

test('odd rooms split within one, and the smaller side pulls as hard per head', () => {
  const names = ['a', 'b', 'c', 'd', 'e']
  const w = world(names)
  assert.deepEqual(w.sides.map((s) => s.members.length).sort(), [2, 3])
  assert.deepEqual([...w.sides[0].members, ...w.sides[1].members].sort(), names)
  run(w, 3000, () => true)
  assert.ok(Math.abs(w.flag) < 1e-9, `everyone mashing alike holds the centre (${w.flag})`)
})

test('alternates down the standings, ties in join order', () => {
  const sides = splitSides(['a', 'b', 'c', 'd'], solo(['d', 'c', 'b', 'a'], { a: 300, b: 200 }))
  assert.deepEqual(sides.map((s) => s.members), [['d', 'a'], ['c', 'b']])
  assert.deepEqual(sides.map((s) => s.name), ['Red', 'Blue'])
  const fresh = splitSides(['a', 'b', 'c'], solo(['c', 'a', 'b']))
  assert.deepEqual(fresh.map((s) => s.members), [['c', 'b'], ['a']])
})

test('a teams grouping keeps teams whole and names the sides after them', () => {
  const teams: Team[] = [{ id: 't1', name: 'Owls', color: '#f00' }, { id: 't2', name: 'Bats', color: '#00f' }]
  const roster = players('a', 'b', 'c', 'd').map((p, i) => ({ ...p, teamId: i < 2 ? 't1' : 't2' }))
  const sides = splitSides(['a', 'b', 'c', 'd'], { grouping: 'teams', players: roster, teams, scores: {} })
  assert.deepEqual(sides.map((s) => [s.name, s.color, s.members]), [['Owls', '#f00', ['a', 'b']], ['Bats', '#00f', ['c', 'd']]])

  const three: Team[] = [...teams, { id: 't3', name: 'Cats', color: '#0f0' }]
  const six = players('a', 'b', 'c', 'd', 'e').map((p, i) => ({ ...p, teamId: ['t1', 't1', 't2', 't3', 't3'][i] }))
  const folded = splitSides(six.map((p) => p.id), { grouping: 'teams', players: six, teams: three, scores: {} })
  assert.deepEqual(folded.map((s) => s.members), [['a', 'b', 'c'], ['d', 'e']], 'the biggest teams first, each to the smaller side')
  assert.deepEqual(folded.map((s) => s.name), ['Red', 'Cats'])

  const twoAndFour = [...three, { id: 't4', name: 'Dogs', color: 'var(--id-3)' }]
  const crowd = players('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h').map((p, i) => ({ ...p, teamId: ['t4', 't4', 't4', 't4', 't1', 't1', 't2', 't2'][i] }))
  const clash = splitSides(crowd.map((p) => p.id), { grouping: 'teams', players: crowd, teams: twoAndFour, scores: {} })
  assert.equal(clash[0].name, 'Dogs')
  assert.notEqual(clash[1].color, clash[0].color, 'a mixed side never wears the other side\'s colour')
  assert.equal(clash[1].name, 'Red')

  const oneTeam = players('a', 'b', 'c').map((p) => ({ ...p, teamId: 't1' }))
  const alone = splitSides(['a', 'b', 'c'], { grouping: 'teams', players: oneTeam, teams, scores: {} })
  assert.deepEqual(alone.map((s) => s.members.length), [2, 1], 'one team alone splits like solo')
})

test('a disconnected puller counts for nothing, either way', () => {
  const w = world(['a', 'b', 'c', 'd'])
  const [gone, stays] = w.sides[0].members
  tugPresence(w, ['a', 'b', 'c', 'd'].filter((id) => id !== gone))
  assert.equal(pull(w, gone), false, 'their taps are ignored')
  run(w, 3000, (id) => id !== gone)
  assert.ok(Math.abs(w.flag) < 1e-9, `the side is not weaker for the empty place (${w.flag})`)
  assert.ok(w.pullers[stays].pull > 0)
})
