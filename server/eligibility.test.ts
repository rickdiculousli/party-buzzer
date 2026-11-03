import test from 'node:test'
import assert from 'node:assert/strict'
import { newState } from './state.ts'
import { reactBlockReason } from './eligibility.ts'
import type { State } from '../shared/protocol.ts'

const locked = (): State => {
  const s = newState()
  s.players.push({ id: 'ada', name: 'Ada', connected: true }, { id: 'bo', name: 'Bo', connected: true })
  s.round = { ...s.round, questionId: 'q1', attemptId: 'a1', phase: 'LOCKED', order: [{ playerId: 'ada', name: 'Ada', at: 1, deltaMs: 0 }], total: 1 }
  return s
}

test('reactions come from the phones that cannot buzz: locked and not answering, or a verdict up', () => {
  const s = locked()
  assert.equal(reactBlockReason(s, 'bo'), null, 'locked out while Ada answers')
  assert.equal(reactBlockReason(s, 'ada'), 'answering', 'the leader is refused')
  s.round.award = { name: 'Ada', points: 400 }
  assert.equal(reactBlockReason(s, 'ada'), null, 'with the award up even the scorer may react')
  assert.equal(reactBlockReason(s, 'bo'), null)
  s.round = { ...s.round, phase: 'IDLE', order: [] }
  assert.equal(reactBlockReason(s, 'bo'), null, 'the award outlives the lock, until the next arm clears it')
})

test('idle, armed, an arrival and a minigame refuse', () => {
  const idle = newState()
  assert.equal(reactBlockReason(idle, 'bo'), 'not-locked')
  assert.equal(reactBlockReason({ ...idle, round: { ...idle.round, phase: 'ARMED', questionId: 'q1' } }, 'bo'), 'not-locked')
  assert.equal(reactBlockReason({ ...locked(), arrival: { kind: 'lobby', id: 'L', testedPlayerIds: [] } }, 'bo'), 'arrival')
  const withMatch = locked()
  withMatch.minigame = { id: 'bow', matchId: 'm1', phase: 'ready' } as State['minigame']
  assert.equal(reactBlockReason(withMatch, 'bo'), 'minigame')
})
