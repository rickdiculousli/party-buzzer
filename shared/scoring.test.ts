import test from 'node:test'
import assert from 'node:assert/strict'
import { bump, lockedPlayerIds, scoreKey } from './scoring.ts'
import type { Round } from './protocol.ts'

test('scoring and lockouts use the same team key while unassigned players remain independent', () => {
  const players = [
    { id: 'ada', name: 'Ada', connected: true, teamId: 'red' },
    { id: 'bo', name: 'Bo', connected: true, teamId: 'red' },
    { id: 'cy', name: 'Cy', connected: true },
  ]
  const round: Round = {
    questionId: '', attemptId: '', armedAt: 0, value: 100,
    phase: 'IDLE', order: [], total: 0, lockedOut: ['red'],
  }
  const teamState = { players, grouping: 'teams' as const, round, scores: {} as Record<string, number> }
  bump(teamState, scoreKey(teamState, 'ada'), 200)
  bump(teamState, scoreKey(teamState, 'bo'), -50)
  bump(teamState, scoreKey(teamState, 'cy'), 100)
  assert.deepEqual(teamState.scores, { red: 150, cy: 100 })
  assert.deepEqual(lockedPlayerIds(teamState), ['ada', 'bo'])
  const solo = { ...teamState, grouping: 'solo' as const }
  assert.equal(scoreKey(solo, 'ada'), 'ada')
  assert.deepEqual(lockedPlayerIds(solo), [], 'team penalties do not bar solo players')
})
