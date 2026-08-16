import test from 'node:test'
import assert from 'node:assert/strict'
import { newState } from './state.ts'
import { resolveDuel } from './duel.ts'
import type { Mode, PlayerId, State } from '../shared/protocol.ts'

/** A state with named players; the optional second tuple element is a team id. */
export function stateWith(players: [PlayerId, string?][], mode: Mode = 'solo'): State {
  const state = newState()
  state.mode = mode
  const teamIds = [...new Set(players.map(([, t]) => t).filter((t): t is string => !!t))]
  state.teams = teamIds.map((id) => ({ id, name: id, color: 'var(--id-1)' }))
  state.players = players.map(([id, teamId]) => ({ id, name: id, teamId, connected: true }))
  return state
}

/** A duel in mid-setup, without going through the host action (Task 4's subject). */
export function openDuel(state: State, rule: string): void {
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
