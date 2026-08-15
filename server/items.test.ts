import test from 'node:test'
import assert from 'node:assert/strict'
import { executeGrants, ITEMS, useItem } from './items.ts'
import { newState } from './state.ts'
import type { State } from '../shared/protocol.ts'

function twoPlayers(): State {
  const state = newState()
  state.players.push(
    { id: 'p1', name: 'Ada', connected: true },
    { id: 'p2', name: 'Bo', connected: true },
  )
  return state
}

test('using an item you do not hold changes nothing', () => {
  const state = twoPlayers()
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'p2' }), false)
  assert.deepEqual(state.effects, [])
})

test('freeze marks the target for the next question and is consumed', () => {
  const state = twoPlayers()
  state.items.p1 = ['freeze']
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'p2' }), true)
  assert.deepEqual(state.effects, [{ kind: 'frozen', playerId: 'p2' }])
  assert.equal(state.items.p1, undefined, 'the empty inventory is dropped')
})

test('freeze cannot be fired mid-question', () => {
  const state = twoPlayers()
  state.items.p1 = ['freeze']
  state.round.phase = 'COLLECTING'
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'p2' }), false)
  assert.deepEqual(state.items.p1, ['freeze'], 'a refused use consumes nothing')
})

test('a held shield eats the freeze aimed at its holder', () => {
  const state = twoPlayers()
  state.items.p1 = ['freeze']
  state.items.p2 = ['shield']
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'p2' }), true)
  assert.deepEqual(state.effects, [], 'no freeze landed')
  assert.equal(state.items.p2, undefined, 'the shield was spent')
})

test('shield is passive: it can never be fired by hand', () => {
  const state = twoPlayers()
  state.items.p1 = ['shield']
  assert.equal(useItem(state, 'p1', { itemId: 'shield' }), false)
  assert.deepEqual(state.items.p1, ['shield'])
})

test('steal only works on a rebound, and stamps this arm', () => {
  const state = twoPlayers()
  state.items.p2 = ['steal']
  state.round.phase = 'COLLECTING'
  state.round.armedAt = 50
  // First asking: nobody is locked out, so there is nothing to steal.
  assert.equal(useItem(state, 'p2', { itemId: 'steal' }), false)
  // Rebound: p1 answered wrong and is locked out; p2 jumps the queue.
  state.round.lockedOut = ['p1']
  assert.equal(useItem(state, 'p2', { itemId: 'steal' }), true)
  assert.deepEqual(state.effects, [{ kind: 'steal', playerId: 'p2', roundArmedAt: 50 }])
})

test('the locked-out player cannot steal their own rebound', () => {
  const state = twoPlayers()
  state.items.p1 = ['steal']
  state.round.phase = 'COLLECTING'
  state.round.armedAt = 50
  state.round.lockedOut = ['p1']
  assert.equal(useItem(state, 'p1', { itemId: 'steal' }), false)
})

test('freeze refuses a target that is missing, yourself, or absent', () => {
  const state = twoPlayers()
  state.items.p1 = ['freeze']
  assert.equal(useItem(state, 'p1', { itemId: 'freeze' }), false)
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'p1' }), false)
  assert.equal(useItem(state, 'p1', { itemId: 'freeze', targetId: 'ghost' }), false)
  assert.deepEqual(state.items.p1, ['freeze'])
})

test('executeGrants fills inventories and skips junk', () => {
  const state = twoPlayers()
  executeGrants(state, [
    { playerId: 'p1', itemId: 'freeze' },
    { playerId: 'p1', itemId: 'freeze' },
    { playerId: 'ghost', itemId: 'steal' },
    { playerId: 'p2', itemId: 'bogus' },
  ])
  assert.deepEqual(state.items.p1, ['freeze', 'freeze'])
  assert.equal(state.items.p2, undefined)
  assert.equal(state.items.ghost, undefined)
})
