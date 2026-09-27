import test from 'node:test'
import assert from 'node:assert/strict'
import { applyHostAction, newState } from '../state.ts'
import { catalog } from './index.ts'

test('pure buzzer: wrong reopens to everyone forever, nothing is ever scored', () => {
  const state = newState()
  applyHostAction(state, { a: 'setMode', id: 'buzzer', options: {} })
  state.players.push({ id: 'p1', name: 'Ada', connected: true })
  state.round.value = 300
  applyHostAction(state, { a: 'arm' })
  const question = state.round.questionId
  for (let i = 0; i < 3; i++) {
    state.round.phase = 'LOCKED'
    state.round.order = [{ playerId: 'p1', name: 'Ada', at: 0, deltaMs: 0 }]
    assert.equal(applyHostAction(state, { a: 'wrong', neg: 300 }).status, 'applied')
    assert.equal(state.round.phase, 'ARMED')
    assert.equal(state.round.questionId, question)
    assert.deepEqual(state.round.lockedOut, [])
  }
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'p1', name: 'Ada', at: 0, deltaMs: 0 }]
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.round.award?.points, 0)
  assert.equal(state.scores.p1 ?? 0, 0)
  assert.equal(catalog().find((g) => g.id === 'buzzer')?.scoreless, true)
})
