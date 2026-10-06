import test from 'node:test'
import assert from 'node:assert/strict'
import { activePracticePlayers, emptyPractice, prunePractice, recordPractice } from './arrival-feedback.ts'

test('a pulse lasts 600 ms from receipt and only within its lobby', () => {
  const receipt = { lobbyId: 'lobby-a', seq: 1, playerId: 'ada' }
  const tested = recordPractice(emptyPractice('lobby-a'), receipt, 'lobby-a', 1000)
  assert.deepEqual(activePracticePlayers(tested, 'lobby-a', 1599), ['ada'])
  assert.deepEqual(activePracticePlayers(tested, 'lobby-a', 1600), [])
  assert.deepEqual(activePracticePlayers(tested, 'lobby-b', 1000), [])
})

test('players pulse together and a repeat refreshes only its own player', () => {
  let f = emptyPractice('L')
  f = recordPractice(f, { lobbyId: 'L', seq: 1, playerId: 'ada' }, 'L', 1000)
  f = recordPractice(f, { lobbyId: 'L', seq: 2, playerId: 'bo' }, 'L', 1100)
  assert.deepEqual(activePracticePlayers(f, 'L', 1200).sort(), ['ada', 'bo'])

  f = recordPractice(f, { lobbyId: 'L', seq: 3, playerId: 'ada' }, 'L', 1400)
  assert.equal(f.pulses.bo.receivedAt, 1100, 'Bo keeps his own time')
  assert.deepEqual(activePracticePlayers(f, 'L', 1700), ['ada'])
  assert.deepEqual(activePracticePlayers(f, 'L', 1999), ['ada'])
  assert.deepEqual(activePracticePlayers(f, 'L', 2000), [])
})

test('duplicate, older and foreign-lobby receipts leave the feedback unchanged', () => {
  const f = recordPractice(emptyPractice('L'), { lobbyId: 'L', seq: 5, playerId: 'ada' }, 'L', 1000)
  assert.equal(recordPractice(f, { lobbyId: 'L', seq: 5, playerId: 'ada' }, 'L', 1200), f)
  assert.equal(recordPractice(f, { lobbyId: 'L', seq: 4, playerId: 'ada' }, 'L', 1200), f)
  assert.equal(recordPractice(f, { lobbyId: 'old', seq: 9, playerId: 'ada' }, 'L', 1200), f)
  assert.equal(recordPractice(f, { lobbyId: 'L', seq: 9, playerId: 'ada' }, undefined, 1200), f)
})

test('pruning drops departed players and clears on a new or absent lobby', () => {
  let f = emptyPractice('L')
  f = recordPractice(f, { lobbyId: 'L', seq: 1, playerId: 'ada' }, 'L', 1000)
  f = recordPractice(f, { lobbyId: 'L', seq: 2, playerId: 'bo' }, 'L', 1000)

  const kept = prunePractice(f, 'L', ['ada', 'bo'])
  assert.equal(kept, f, 'nothing to prune keeps identity')
  assert.deepEqual(Object.keys(prunePractice(f, 'L', ['ada']).pulses), ['ada'])
  assert.deepEqual(prunePractice(f, 'M', ['ada', 'bo']), emptyPractice('M'))
  assert.deepEqual(prunePractice(f, undefined, ['ada', 'bo']), emptyPractice())
})

test('a renamed player keeps their pulse: feedback is keyed by id, names come from the roster', () => {
  const f = recordPractice(emptyPractice('L'), { lobbyId: 'L', seq: 1, playerId: 'ada' }, 'L', 1000)
  const roster = [{ id: 'ada', name: 'Ada Lovelace' }]
  const names = activePracticePlayers(f, 'L', 1100).map((id) => roster.find((p) => p.id === id)?.name)
  assert.deepEqual(names, ['Ada Lovelace'])
})
