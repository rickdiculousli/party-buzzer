import test from 'node:test'
import assert from 'node:assert/strict'
import { applyHostAction, newState } from '../state.ts'
import { moduleFor } from './index.ts'
import { ITEMS } from '../items.ts'
import type { State } from '../../shared/protocol.ts'

function quizbowlState(options: Record<string, unknown> = {}): State {
  const state = newState()
  applyHostAction(state, {
    a: 'setMode',
    id: 'quizbowl',
    options: { powerAfterFragment: 2, powerBonus: 50, neg: 50, ...options },
  })
  state.players.push(
    { id: 'p1', name: 'Ada', connected: true },
    { id: 'p2', name: 'Bo', connected: true },
  )
  return state
}

/** Drive a round to LOCKED with p1 leading at `at`. */
function locked(state: State, at: number): void {
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'p1', name: 'Ada', at, deltaMs: 0 }]
}

test('registration and option sanitizing', () => {
  const state = quizbowlState()
  assert.equal(state.game.id, 'quizbowl')
  assert.equal(state.game.options.powerBonus, 50)
  const over = newState()
  applyHostAction(over, { a: 'setMode', id: 'quizbowl', options: { powerBonus: 99999 } })
  assert.equal(over.game.options.powerBonus, 500, 'clamped to the spec max')
})

test('switching modes resets scores, items, effects, and the round', () => {
  const state = quizbowlState()
  state.scores.p1 = 500
  state.items.p1 = ['freeze']
  state.effects = [{ kind: 'frozen', playerId: 'p2' }]
  state.round.fragments = ['half a question']
  applyHostAction(state, { a: 'setMode', id: 'trivia', options: {} })
  assert.deepEqual(state.scores, {})
  assert.deepEqual(state.items, {})
  assert.deepEqual(state.effects, [])
  assert.equal(state.round.fragments, undefined)
})

test('a buzz before the power cutoff scores value + bonus', () => {
  const state = quizbowlState()
  state.round.value = 200
  const mod = moduleFor('quizbowl')
  state.round.phase = 'ARMED'
  state.round.armedAt = 1000
  mod.onAct!(state, 'powerEnds') // powerEndsAt = now, after the buzz below
  ;(state.game.moduleState as { powerEndsAt: number }).powerEndsAt = 1500
  locked(state, 1200)
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.scores.p1, 250)
  assert.deepEqual(state.round.award, { name: 'Ada', points: 250 })
})

test('a buzz after the cutoff scores the plain value', () => {
  const state = quizbowlState()
  state.round.value = 200
  ;(state.game.moduleState as { powerEndsAt?: number }).powerEndsAt = 1500
  locked(state, 1600)
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.scores.p1, 200)
})

test('no signal at all: power stays open the whole question', () => {
  const state = quizbowlState()
  state.round.value = 200
  locked(state, 99999)
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.scores.p1, 250, 'graceful degradation: everything is a power')
})

test('powerAfterFragment 0 turns powers off', () => {
  const state = quizbowlState({ powerAfterFragment: 0 })
  state.round.value = 200
  locked(state, 1)
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.scores.p1, 200)
})

test('arm clears the power signal; a rebound keeps it', () => {
  const state = quizbowlState()
  const ms = state.game.moduleState as { powerEndsAt?: number }
  ms.powerEndsAt = 1234
  applyHostAction(state, { a: 'arm' })
  assert.equal(ms.powerEndsAt, undefined)

  ms.powerEndsAt = 1234
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'p1', name: 'Ada', at: 1, deltaMs: 0 }]
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.equal(ms.powerEndsAt, 1234, 'the rebound is still the same question')
})

test('wrong applies the configured neg and locks out, whatever the host sent', () => {
  const state = quizbowlState()
  locked(state, 1)
  applyHostAction(state, { a: 'wrong', neg: 200 })
  assert.equal(state.scores.p1, -50, 'the module\'s neg wins')
  assert.deepEqual(state.round.lockedOut, ['p1'])
  assert.equal(state.round.phase, 'ARMED', 'rebound')
})

test('the host\'s no-penalty button (neg 0) always means it', () => {
  const state = quizbowlState()
  locked(state, 1)
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.equal(state.scores.p1, 0)
})

test('bouncebacks off: the wrong answerer is not locked out', () => {
  const state = quizbowlState({ bouncebacks: false })
  locked(state, 1)
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.deepEqual(state.round.lockedOut, [])
})

test('a correct answer grants the leader one random item when items are on', () => {
  const state = quizbowlState({ itemsEnabled: true })
  locked(state, 1)
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.items.p1?.length, 1)
  assert.ok(ITEMS.some((i) => i.id === state.items.p1[0]))
})

test('no grants when items are off, and trivia never grants', () => {
  const off = quizbowlState()
  locked(off, 1)
  applyHostAction(off, { a: 'correct' })
  assert.deepEqual(off.items, {})

  const trivia = newState()
  trivia.players.push({ id: 'p1', name: 'Ada', connected: true })
  trivia.round.phase = 'LOCKED'
  trivia.round.order = [{ playerId: 'p1', name: 'Ada', at: 1, deltaMs: 0 }]
  applyHostAction(trivia, { a: 'correct' })
  assert.deepEqual(trivia.items, {})
})

test('onAct ignores acts it does not own', () => {
  const state = quizbowlState()
  assert.equal(moduleFor('quizbowl').onAct!(state, 'bogus'), false)
})

test('quizbowl exposes no module state to players', () => {
  const mod = moduleFor('quizbowl')
  assert.equal(mod.viewModuleState, undefined, 'the framework default hides it from phones')
})
