import test from 'node:test'
import assert from 'node:assert/strict'
import { Hub, type Conn } from '../hub.ts'
import { newState } from '../state.ts'
import { moduleFor } from './index.ts'

const host: Conn = { id: 'h', role: 'host', send() {} }
const phone: Conn = { id: 'p', role: 'player', playerId: 'ada', send() {} }

function rig(options: Record<string, unknown> = {}) {
  const state = newState()
  const hub = new Hub(state)
  hub.dispatch({ a: 'setMode', id: 'quizbowl', options })
  hub.dispatch({ a: 'arm' })
  return { state, hub }
}

test('fragment completion closes the configured power once and the host gets status data', (t) => {
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  const { state, hub } = rig({ powerAfterFragment: 2 })
  const questionId = state.round.questionId
  assert.deepEqual(hub.viewFor(host).game.status, { label: 'Power open', tone: 'active' })
  hub.fragmentEnded(questionId, 1)
  assert.deepEqual(state.game.moduleState, { powerEndsAt: undefined })
  now = 2000
  hub.fragmentEnded(questionId, 2)
  assert.deepEqual(state.game.moduleState, { powerEndsAt: 2000 })
  assert.deepEqual(hub.viewFor(host).game.status, { label: 'Power ended', tone: 'inactive' })
  now = 3000
  hub.fragmentEnded(questionId, 3)
  assert.deepEqual(state.game.moduleState, { powerEndsAt: 2000 }, 'later fragments cannot move the cutoff')
  assert.equal(state.game.status, undefined, 'status is a projection, not stored game data')
  assert.equal(hub.viewFor(phone).game.status, undefined)
  assert.equal(hub.viewFor(phone).game.moduleState, undefined)
})

test('stale and post-verdict completion cannot modify the current question', () => {
  const { state, hub } = rig({ powerAfterFragment: 1 })
  const oldQuestion = state.round.questionId
  hub.dispatch({ a: 'arm' })
  hub.fragmentEnded(oldQuestion, 1)
  assert.deepEqual(hub.viewFor(host).game.status, { label: 'Power open', tone: 'active' })
  state.round.phase = 'IDLE'
  hub.fragmentEnded(state.round.questionId, 1)
  assert.deepEqual(hub.viewFor(host).game.status, { label: 'Power open', tone: 'active' })
})

test('disabled powers and trivia require no reader-specific behavior', () => {
  const { state, hub } = rig({ powerAfterFragment: 0 })
  hub.fragmentEnded(state.round.questionId, 99)
  assert.equal(hub.viewFor(host).game.status, undefined)
  assert.deepEqual(state.game.moduleState, { powerEndsAt: undefined })
  hub.dispatch({ a: 'next' })
  hub.dispatch({ a: 'setMode', id: 'trivia', options: {} })
  hub.dispatch({ a: 'arm' })
  hub.fragmentEnded(state.round.questionId, 99)
  assert.equal(hub.viewFor(host).game.status, undefined)
  assert.deepEqual(state.game.moduleState, {})
})

test('a mode completion update is not an extra undo step', () => {
  const { state, hub } = rig({ powerAfterFragment: 1 })
  hub.fragmentEnded(state.round.questionId, 1)
  hub.dispatch({ a: 'undo' })
  assert.equal(state.round.phase, 'IDLE', 'undo reverses the arm, not a runtime publication')
  assert.deepEqual(state.game.moduleState, {})
})

test('host status is optional module behavior', () => {
  assert.equal(moduleFor('trivia').hostStatus, undefined)
  assert.equal(moduleFor('trivia').onFragmentEnd, undefined)
})
