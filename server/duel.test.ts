import test from 'node:test'
import assert from 'node:assert/strict'
import { applyHostAction, newState } from './state.ts'
import { resolveDuel, duelAct, seatDuel } from './duel.ts'
import type { Mode, PlayerId, State } from '../shared/protocol.ts'

/** A state with named players; the optional second tuple element is a team id. */
function stateWith(players: [PlayerId, string?][], mode: Mode = 'solo'): State {
  const state = newState()
  state.mode = mode
  const teamIds = [...new Set(players.map(([, t]) => t).filter((t): t is string => !!t))]
  state.teams = teamIds.map((id) => ({ id, name: id, color: 'var(--id-1)' }))
  state.players = players.map(([id, teamId]) => ({ id, name: id, teamId, connected: true }))
  return state
}

/** A duel in mid-setup, without going through the host action (Task 4's subject). */
function openDuel(state: State, rule: string): void {
  state.duel = { rule, pool: [], missed: [] }
}

test('vote resolution seats the top two, pool order breaking ties', () => {
  const state = stateWith([['a'], ['b'], ['c'], ['d']])
  openDuel(state, 'vote')
  const duel = state.duel!
  duel.pool.push(
    { playerId: 'a', votes: ['c', 'd'], in: false },
    { playerId: 'b', votes: ['a'], in: false },
    { playerId: 'c', votes: ['b'], in: false },
  )
  // a leads on 2; b and c tie on 1 and b entered the pool first.
  assert.deepEqual(resolveDuel(state, duel), ['a', 'b'])
})

test('vote resolution skips the unteamed in teams mode', () => {
  const state = stateWith([['a', 'ta'], ['b', 'tb'], ['c'], ['d', 'ta']], 'teams')
  openDuel(state, 'vote')
  const duel = state.duel!
  duel.pool.push(
    { playerId: 'c', votes: ['a', 'b'], in: false }, // most votes, but no team
    { playerId: 'a', votes: ['c'], in: false },
    { playerId: 'b', votes: ['d'], in: false },
  )
  assert.deepEqual(resolveDuel(state, duel), ['a', 'b'])
})

test('teams mode never seats two finalists from one team', () => {
  const state = stateWith([['a', 'ta'], ['b', 'ta'], ['c', 'tb']], 'teams')
  openDuel(state, 'vote')
  const duel = state.duel!
  duel.pool.push(
    { playerId: 'a', votes: ['c'], in: false },
    { playerId: 'b', votes: ['a'], in: false }, // same team as a — skipped
    { playerId: 'c', votes: ['b'], in: false },
  )
  assert.deepEqual(resolveDuel(state, duel), ['a', 'c'])
})

test('a thin pool resolves to nothing', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  openDuel(state, 'vote')
  state.duel!.pool.push({ playerId: 'a', votes: ['b'], in: false })
  assert.equal(resolveDuel(state, state.duel!), null)
})

test('host-resolve rules never auto-seat', () => {
  const state = stateWith([['a'], ['b']])
  openDuel(state, 'host-pick')
  assert.equal(resolveDuel(state, state.duel!), null)
})

test('volunteer-random draws only from the in pool', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  openDuel(state, 'volunteer-random')
  state.duel!.pool.push(
    { playerId: 'a', votes: [], in: true },
    { playerId: 'b', votes: [], in: true },
    { playerId: 'c', votes: [], in: false }, // backed off
  )
  const pair = resolveDuel(state, state.duel!)
  assert.deepEqual(pair?.slice().sort(), ['a', 'b'])
})

test('a disconnected pool member cannot be seated', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  state.players.find((p) => p.id === 'c')!.connected = false
  openDuel(state, 'vote')
  state.duel!.pool.push(
    { playerId: 'c', votes: ['a', 'b'], in: false },
    { playerId: 'a', votes: ['c'], in: false },
  )
  assert.equal(resolveDuel(state, state.duel!), null, 'only one seatable candidate')
})

test('gates: acts that do not match the rule are dropped', () => {
  const state = stateWith([['a'], ['b']])
  openDuel(state, 'vote')
  assert.equal(duelAct(state, 'a', 'duelVolunteer'), false, 'no volunteering under a vote rule')
  assert.equal(duelAct(state, 'a', 'duelBackOff'), false)
  assert.equal(state.duel!.pool.length, 0)
  assert.equal(duelAct(state, 'a', 'duelVote', 'b'), true)
  assert.equal(state.duel!.pool.length, 1)
})

test('a self-vote or a vote for a ghost is dropped', () => {
  const state = stateWith([['a'], ['b']])
  openDuel(state, 'vote')
  assert.equal(duelAct(state, 'a', 'duelVote', 'a'), false)
  assert.equal(duelAct(state, 'a', 'duelVote', 'ghost'), false)
  state.players.find((p) => p.id === 'b')!.connected = false
  assert.equal(duelAct(state, 'a', 'duelVote', 'b'), false, 'disconnected target')
  assert.equal(state.duel!.pool.length, 0)
})

test('re-voting moves the vote; one player never counts twice', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  openDuel(state, 'vote')
  duelAct(state, 'a', 'duelVote', 'b')
  duelAct(state, 'a', 'duelVote', 'c')
  assert.deepEqual(state.duel!.pool.find((e) => e.playerId === 'b')!.votes, [])
  assert.deepEqual(state.duel!.pool.find((e) => e.playerId === 'c')!.votes, ['a'])
})

test('voting again for the same name takes the vote back', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  openDuel(state, 'vote')
  duelAct(state, 'a', 'duelVote', 'c')
  duelAct(state, 'b', 'duelVote', 'c')
  assert.equal(duelAct(state, 'a', 'duelVote', 'c'), true)
  const entry = state.duel!.pool.find((e) => e.playerId === 'c')!
  // The tally drops by one and the name stays put — the count going down in
  // place is the whole point, on the board as much as in the data.
  assert.deepEqual(entry.votes, ['b'])
  assert.equal(duelAct(state, 'b', 'duelVote', 'c'), true)
  assert.deepEqual(entry.votes, [])
  // Withdrawn, not spent: the same player can vote again afterwards.
  assert.equal(duelAct(state, 'a', 'duelVote', 'b'), true)
  assert.deepEqual(state.duel!.pool.find((e) => e.playerId === 'b')!.votes, ['a'])
})

test('volunteer and back-off under a volunteer rule', () => {
  const state = stateWith([['a'], ['b']])
  openDuel(state, 'volunteer-backoff')
  assert.equal(duelAct(state, 'a', 'duelVote', 'b'), false, 'no voting here')
  assert.equal(duelAct(state, 'a', 'duelVolunteer'), true)
  assert.equal(duelAct(state, 'a', 'duelVolunteer'), false, 'already in')
  assert.equal(duelAct(state, 'a', 'duelBackOff'), true)
  assert.equal(state.duel!.pool[0].in, false)
  assert.equal(duelAct(state, 'a', 'duelBackOff'), false, 'already out')
})

test('entry stops once the duel is seated', () => {
  const state = stateWith([['a'], ['b']])
  openDuel(state, 'host-pick')
  assert.ok(seatDuel(state, ['a', 'b']))
  assert.equal(duelAct(state, 'a', 'duelVolunteer'), false)
})

test('seatDuel validates: distinct, eligible, one per team', () => {
  const state = stateWith([['a', 'ta'], ['b', 'ta'], ['c', 'tb']], 'teams')
  openDuel(state, 'host-pick')
  assert.equal(seatDuel(state, ['a', 'a']), false)
  assert.equal(seatDuel(state, ['a', 'ghost']), false)
  assert.equal(seatDuel(state, ['a', 'b']), false, 'same team')
  assert.equal(seatDuel(state, ['a', 'c']), true)
  assert.deepEqual(state.duel!.seated, ['a', 'c'])
})

test('openDuel is refused mid-round and for unknown rules', () => {
  const state = stateWith([['a'], ['b']])
  state.round.phase = 'ARMED'
  applyHostAction(state, { a: 'openDuel', rule: 'vote' })
  assert.equal(state.duel, undefined)
  state.round.phase = 'IDLE'
  applyHostAction(state, { a: 'openDuel', rule: 'bogus' })
  assert.equal(state.duel, undefined)
})

test('random seats instantly; one team total cannot fill two seats', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  applyHostAction(state, { a: 'openDuel', rule: 'random' })
  const seated = state.duel?.seated
  assert.ok(seated)
  assert.notEqual(seated[0], seated[1])

  const teamed = stateWith([['a', 'ta'], ['b', 'ta']], 'teams')
  applyHostAction(teamed, { a: 'openDuel', rule: 'random' })
  assert.equal(teamed.duel, undefined, 'refused: nothing to close later')
})

test('volunteer-random waits for the window; random still seats instantly', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  applyHostAction(state, { a: 'openDuel', rule: 'volunteer-random' })
  assert.ok(state.duel, 'the duel opens')
  assert.equal(state.duel!.seated, undefined, 'no volunteers yet — nothing to draw from')
  assert.deepEqual(state.duel!.pool, [])

  const randomState = stateWith([['a'], ['b'], ['c']])
  applyHostAction(randomState, { a: 'openDuel', rule: 'random' })
  assert.ok(randomState.duel?.seated, 'random has no entry gate — seats now')
})

test('random in teams mode draws one per team', () => {
  const state = stateWith([['a', 'ta'], ['b', 'ta'], ['c', 'tb']], 'teams')
  applyHostAction(state, { a: 'openDuel', rule: 'random' })
  const [x, y] = state.duel!.seated!
  const teamOf = (id: string) => state.players.find((p) => p.id === id)?.teamId
  assert.notEqual(teamOf(x), teamOf(y))
})

test('closeDuel with a thin pool stays open', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  applyHostAction(state, { a: 'openDuel', rule: 'vote' })
  state.duel!.pool.push({ playerId: 'a', votes: ['b'], in: false })
  applyHostAction(state, { a: 'closeDuel' })
  assert.equal(state.duel!.seated, undefined, 'still collecting')
})

test('closeDuel is refused once the question is live', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  applyHostAction(state, { a: 'openDuel', rule: 'host-pick' })
  state.round.phase = 'ARMED'
  applyHostAction(state, { a: 'closeDuel', playerIds: ['a', 'b'] })
  assert.equal(state.duel!.seated, undefined)
})

test('arm stamps the seated pair; next clears the duel', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  applyHostAction(state, { a: 'openDuel', rule: 'host-pick' })
  applyHostAction(state, { a: 'closeDuel', playerIds: ['a', 'b'] })
  applyHostAction(state, { a: 'arm' })
  assert.deepEqual(state.round.candidates, ['a', 'b'])
  applyHostAction(state, { a: 'next' })
  assert.equal(state.duel, undefined)
  assert.equal(state.round.candidates, undefined)
})

test('a wrong answer narrows the rebound to the other finalist; a fresh arm resets', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  applyHostAction(state, { a: 'openDuel', rule: 'host-pick' })
  applyHostAction(state, { a: 'closeDuel', playerIds: ['a', 'b'] })
  applyHostAction(state, { a: 'arm' })
  state.round.order = [{ playerId: 'a', name: 'a', at: 1, deltaMs: 0 }]
  state.round.phase = 'LOCKED'
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.deepEqual(state.duel!.missed, ['a'])
  assert.deepEqual(state.round.candidates, ['b'], 'exclusive rebound')

  state.round.order = [{ playerId: 'b', name: 'b', at: 2, deltaMs: 0 }]
  state.round.phase = 'LOCKED'
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.deepEqual(state.round.candidates, [], 'both missed — the round is dead')

  applyHostAction(state, { a: 'arm' })
  assert.deepEqual(state.duel!.missed, [])
  assert.deepEqual(state.round.candidates, ['a', 'b'], 'rematch: same pair, fresh question')
})

test('setGame cancels an unseated duel; a seated one survives', () => {
  const state = stateWith([['a'], ['b']])
  applyHostAction(state, { a: 'openDuel', rule: 'vote' })
  applyHostAction(state, { a: 'setGame', id: 'trivia', options: {} })
  // assert.equal narrows state.duel to undefined via strictEqual's assertion
  // signature, and TS never invalidates that across the mutations below —
  // Boolean() keeps the check but breaks the false narrowing.
  assert.equal(Boolean(state.duel), false)

  applyHostAction(state, { a: 'openDuel', rule: 'host-pick' })
  applyHostAction(state, { a: 'closeDuel', playerIds: ['a', 'b'] })
  applyHostAction(state, { a: 'setGame', id: 'trivia', options: {} })
  assert.ok(state.duel?.seated, 'a seated pair is a commitment, not setup')
})

test('cancelDuel lifts the candidacy mid-round', () => {
  const state = stateWith([['a'], ['b']])
  applyHostAction(state, { a: 'openDuel', rule: 'host-pick' })
  applyHostAction(state, { a: 'closeDuel', playerIds: ['a', 'b'] })
  applyHostAction(state, { a: 'arm' })
  applyHostAction(state, { a: 'cancelDuel' })
  assert.equal(state.duel, undefined)
  assert.equal(state.round.candidates, undefined, 'the floor reopens')
})

test('a vote crosses neither the team line nor the eligibility line', () => {
  const state = stateWith([['a', 'ta'], ['b', 'ta'], ['c', 'tb'], ['d']], 'teams')
  openDuel(state, 'vote')
  // Your own side: the nomination the seat is actually asking for.
  assert.equal(duelAct(state, 'a', 'duelVote', 'b'), true)
  // Across the line: picking your opponent's champion is not a nomination.
  assert.equal(duelAct(state, 'a', 'duelVote', 'c'), false)
  // Nobody the seat could take anyway — d is on no team.
  assert.equal(duelAct(state, 'd', 'duelVote', 'a'), false)
  assert.equal(duelAct(state, 'a', 'duelVote', 'd'), false)
  // The refusals left the one good vote alone.
  assert.deepEqual(state.duel!.pool.map((e) => [e.playerId, e.votes]), [['b', ['a']]])
})

test('solo mode still lets anyone nominate anyone', () => {
  const state = stateWith([['a'], ['b'], ['c']])
  openDuel(state, 'vote')
  assert.equal(duelAct(state, 'a', 'duelVote', 'b'), true)
  assert.equal(duelAct(state, 'b', 'duelVote', 'c'), true)
})
