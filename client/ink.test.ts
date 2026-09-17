import test from 'node:test'
import assert from 'node:assert/strict'
import { freshTouches, lobbyColumns, quantizePoint, strokePath, teamCap, TOUCH_MS } from './ink.ts'
import { newState } from '../server/state.ts'

test('team capacity is half the room, rounded up', () => {
  assert.equal(teamCap(0), 0)
  assert.equal(teamCap(5), 3)
  assert.equal(teamCap(6), 3)
})

test('lobby columns count connected members and flag overfill', () => {
  const state = newState()
  state.players = [
    { id: 'a', name: 'Ada', connected: true },
    { id: 'b', name: 'Bo', connected: true },
    { id: 'c', name: 'Cy', connected: true },
    { id: 'd', name: 'Dee', connected: false },
  ]
  state.minigame = {
    id: 'ink', matchId: 'm', phase: 'ready', options: { durationSec: 40, seed: 1 }, participants: [],
    lobby: { teams: { a: 'sun', b: 'sun', c: 'sun', d: 'moon' }, volunteers: ['b'] },
  }
  const [sun, moon] = lobbyColumns(state)
  assert.equal(sun.count, 3)
  assert.equal(sun.cap, 2)
  assert.equal(sun.over, true)
  assert.deepEqual(sun.members.map((m) => [m.name, m.volunteer]), [['Ada', false], ['Bo', true], ['Cy', false]])
  assert.equal(moon.count, 0)
  assert.equal(moon.over, false)
})

test('stroke paths scale normalized points; a dot becomes a short segment', () => {
  assert.equal(strokePath([[0, 0], [0.5, 1]], 100, 20), 'M0 0L50 20')
  assert.equal(strokePath([[0.1, 0.5]], 100, 20), 'M10 10l0.01 0')
})

test('points clamp to the unit square and round to three decimals', () => {
  assert.deepEqual(quantizePoint(-0.2, 0.12345), [0, 0.123])
  assert.deepEqual(quantizePoint(1.5, 0.9996), [1, 1])
})

test('touches expire after the fade', () => {
  const touch = { playerId: 'a', name: 'Ada', target: 'card:1', x: 0, y: 0 }
  const kept = freshTouches([{ ...touch, at: 0 }, { ...touch, at: 500 }], TOUCH_MS + 1)
  assert.deepEqual(kept.map((t) => t.at), [500])
})
