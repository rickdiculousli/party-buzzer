import test from 'node:test'
import assert from 'node:assert/strict'
import { nightFacts, type LedgerBefore } from './ledger.ts'
import { newState } from './state.ts'
import type { NightFact, State } from '../shared/protocol.ts'

function room(): State {
  const state = newState()
  state.players = [
    { id: 'a', name: 'Ada', connected: true },
    { id: 'b', name: 'Bo', connected: true },
    { id: 'c', name: 'Cy', connected: true },
  ]
  state.scores = { a: 0, b: 0, c: 0 }
  state.round = {
    ...state.round,
    questionId: 'q1',
    phase: 'LOCKED',
    armedAt: 1_000,
    value: 200,
    order: [{ playerId: 'b', name: 'Bo', at: 1_240.4, deltaMs: 0 }, { playerId: 'a', name: 'Ada', at: 1_300, deltaMs: 60 }],
    total: 2,
  }
  return state
}

const before = (s: State): LedgerBefore => structuredClone(s)
const kinds = (facts: NightFact[]) => facts.map((f) => f.kind)

test('correct: a verdict with reaction and margin, then the opening standings', () => {
  const state = room()
  const was = before(state)
  state.scores.b = 200
  state.round.award = { name: 'Bo', points: 200 }
  const facts = nightFacts(was, state, { action: { a: 'correct' } }, 9)
  assert.deepEqual(kinds(facts), ['verdict', 'standings'])
  const [v, s] = facts as [Extract<NightFact, { kind: 'verdict' }>, Extract<NightFact, { kind: 'standings' }>]
  assert.deepEqual(
    [v.playerId, v.key, v.name, v.points, v.hit, v.reactionMs, v.marginMs, v.source, v.questionId],
    ['b', 'b', 'Bo', 200, true, 240, 60, 'buzz', 'q1'],
  )
  assert.deepEqual(s.order.map((o) => o.key), ['b', 'a', 'c'])
  assert.equal(s.questionId, 'q1')
})

test('a lone buzz has no margin, and a block is named only while the setlist is inside it', () => {
  const state = room()
  state.round.order = [state.round.order[0]!]
  state.setlist = { blocks: [{ game: 'trivia', options: {}, count: 2 }], at: 0, done: 0 }
  const [v] = nightFacts(before(state), state, { action: { a: 'correct' } }, 9) as [Extract<NightFact, { kind: 'verdict' }>]
  assert.equal(v.marginMs, undefined)
  assert.equal(v.block, 0)
  state.setlist.at = 1
  const [late] = nightFacts(before(state), state, { action: { a: 'correct' } }, 9) as [Extract<NightFact, { kind: 'verdict' }>]
  assert.equal(late.block, undefined)
})

test('wrong: a missed verdict that costs the penalty', () => {
  const state = room()
  const was = before(state)
  state.scores.b = -100
  state.round.award = { name: 'Bo', points: -100, penalty: true }
  const [v] = nightFacts(was, state, { action: { a: 'wrong', neg: 100 } }, 9) as [Extract<NightFact, { kind: 'verdict' }>]
  assert.deepEqual([v.hit, v.points, v.reactionMs], [false, -100, 240])
})

test('settleChoice: one choice verdict per right pick, with no buzz timing', () => {
  const state = room()
  state.round.picks = { a: 2, b: 1, c: 2 }
  const was = before(state)
  state.scores = { a: 200, b: 0, c: 200 }
  const facts = nightFacts(was, state, { action: { a: 'settleChoice', correct: 2 } }, 9)
  const verdicts = facts.filter((f) => f.kind === 'verdict') as Extract<NightFact, { kind: 'verdict' }>[]
  assert.deepEqual(verdicts.map((v) => [v.playerId, v.source, v.points, v.reactionMs]), [['a', 'choice', 200, undefined], ['c', 'choice', 200, undefined]])
})

test('setScore: a standings fact when the order moves, never a verdict', () => {
  const state = room()
  const was = before(state)
  state.scores.c = 500
  const facts = nightFacts(was, state, { action: { a: 'setScore', key: 'c', score: 500 } }, 9)
  assert.deepEqual(kinds(facts), ['standings'])
})

test('clearNight records nothing, not even standings', () => {
  const state = room()
  assert.deepEqual(nightFacts(before(state), state, { action: { a: 'clearNight' } }, 9), [])
})

test('standings are recorded when the key order changes or first place stops being shared', () => {
  const state = room()
  const first = nightFacts(before(state), state, { action: { a: 'setValue', value: 300 } }, 1)
  assert.deepEqual(kinds(first), ['standings'])
  const was = before(state)
  was.night = { facts: first }
  assert.deepEqual(nightFacts(was, state, { action: { a: 'setValue', value: 400 } }, 2), [], 'same order, same shared top: nothing')
  // Ada was already first by roster order; taking the top outright is still a change.
  state.scores.a = 50
  const outright = nightFacts(was, state, { action: { a: 'setScore', key: 'a', score: 50 } }, 3)
  assert.deepEqual(kinds(outright), ['standings'])
  was.night = { facts: [...first, ...outright] }
  state.scores.a = 70
  assert.deepEqual(nightFacts(was, state, { action: { a: 'setScore', key: 'a', score: 70 } }, 4), [], 'a bigger lead is the same standings')
  state.scores.b = 90
  assert.deepEqual(kinds(nightFacts(was, state, { action: { a: 'setScore', key: 'b', score: 90 } }, 5)), ['standings'])
})

test('a team night keys standings and verdicts by team', () => {
  const state = room()
  state.grouping = 'teams'
  state.teams = [{ id: 't1', name: 'Red', color: '#f00' }, { id: 't2', name: 'Blue', color: '#00f' }]
  state.players[0]!.teamId = 't1'
  state.players[1]!.teamId = 't2'
  const was = before(state)
  state.scores = { t2: 200 }
  const facts = nightFacts(was, state, { action: { a: 'correct' } }, 9)
  const [v, s] = facts as [Extract<NightFact, { kind: 'verdict' }>, Extract<NightFact, { kind: 'standings' }>]
  assert.equal(v.key, 't2')
  assert.deepEqual(s.order, [{ key: 't2', score: 200 }, { key: 't1', score: 0 }])
})

test('a minigame completion records its results under the match, then the standings', () => {
  const state = room()
  const was = before(state)
  state.scores = { a: 0, b: 300, c: 0 }
  const facts = nightFacts(was, state, { results: [{ playerId: 'b', points: 300, shots: 3, place: 1 }], matchId: 'm1', id: 'bow' }, 9)
  assert.deepEqual(kinds(facts), ['minigame', 'standings'])
  assert.equal((facts[1] as Extract<NightFact, { kind: 'standings' }>).matchId, 'm1')
})

test('an item fact names its user and target', () => {
  const state = room()
  const facts = nightFacts(state, state, { item: { itemId: 'freeze', playerId: 'a', targetId: 'b' } }, 9)
  assert.deepEqual(facts, [{ kind: 'item', at: 9, itemId: 'freeze', playerId: 'a', name: 'Ada', targetId: 'b', targetName: 'Bo', questionId: 'q1' }])
})

test('a host correction records untagged standings, so no milestone is ever shown for it', () => {
  const state = room()
  const was = before(state)
  state.scores.c = 500
  const facts = nightFacts(was, state, { action: { a: 'setScore', key: 'c', score: 500 } }, 1)
  assert.deepEqual(kinds(facts), ['standings'])
  assert.equal((facts[0] as Extract<NightFact, { kind: 'standings' }>).questionId, undefined)
  state.scores.c = 0
  const kicked = structuredClone(state)
  kicked.players = kicked.players.filter((p) => p.id !== 'c')
  const after = nightFacts({ ...before(state), night: { facts } }, kicked, { action: { a: 'kick', playerId: 'c' } }, 2)
  assert.deepEqual(kinds(after), ['standings'])
  assert.equal((after[0] as Extract<NightFact, { kind: 'standings' }>).questionId, undefined)
})

test('a press pinned to the arm (a steal, or an early stamp) has no reaction time', () => {
  const state = room()
  state.round.order[0]!.at = state.round.armedAt
  const was = before(state)
  state.round.award = { name: 'Bo', points: 200 }
  const [v] = nightFacts(was, state, { action: { a: 'correct' } }, 1) as [Extract<NightFact, { kind: 'verdict' }>]
  assert.equal(v.reactionMs, undefined)
  assert.equal(v.marginMs, 60)
})
