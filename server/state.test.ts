import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyHostAction, buzzBlockReason, loadState, newState } from './state.ts'
import type { State } from '../shared/protocol.ts'

function withPlayer(state: State): string {
  state.players.push({ id: 'p1', name: 'Ada', connected: true })
  state.scores.p1 = 300
  return 'p1'
}

test('arm sweeps last question\'s effects and stamps the live ones', () => {
  const state = newState()
  state.effects = [
    { kind: 'frozen', playerId: 'old', roundArmedAt: 123 },
    { kind: 'frozen', playerId: 'fresh' },
  ]
  applyHostAction(state, { a: 'arm' })
  assert.deepEqual(
    state.effects,
    [{ kind: 'frozen', playerId: 'fresh', roundArmedAt: state.round.armedAt }],
  )
})

test('a wrong rebound re-stamps effects to the new arm instead of sweeping them', () => {
  const state = newState()
  withPlayer(state)
  state.effects = [{ kind: 'frozen', playerId: 'p1', roundArmedAt: state.round.armedAt }]
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'p1', name: 'Ada', at: 1, deltaMs: 0 }]
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.equal(state.round.phase, 'ARMED')
  assert.equal(state.effects.length, 1)
  assert.equal(state.effects[0].roundArmedAt, state.round.armedAt)
})

test('buzzBlockReason bars a frozen player for exactly the stamped round', () => {
  const state = newState()
  state.round.phase = 'ARMED'
  state.round.armedAt = 999
  state.effects = [{ kind: 'frozen', playerId: 'p1', roundArmedAt: 999 }]
  assert.equal(buzzBlockReason(state, 'p1'), 'frozen')
  assert.equal(buzzBlockReason(state, 'p2'), null)
  state.effects[0].roundArmedAt = 888
  assert.equal(buzzBlockReason(state, 'p1'), null, 'a freeze from another round is inert')
})

test('correct and wrong keep today\'s scoring when the module defines no hooks', () => {
  const state = newState()
  withPlayer(state)
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'p1', name: 'Ada', at: 1, deltaMs: 0 }]
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.scores.p1, 400, '300 + the round value of 100')
  assert.deepEqual(state.round.award, { name: 'Ada', points: 100 })
})

test('setGame with the current id updates options and keeps scores', () => {
  const state = newState()
  withPlayer(state)
  applyHostAction(state, { a: 'setGame', id: 'trivia', options: {} })
  assert.equal(state.scores.p1, 300)
  assert.equal(state.game.id, 'trivia')
})

test('setGame with an unknown id is dropped, logged, and changes nothing', () => {
  const state = newState()
  withPlayer(state)
  applyHostAction(state, { a: 'setGame', id: 'nope', options: {} })
  assert.equal(state.game.id, 'trivia')
  assert.equal(state.scores.p1, 300)
})

test('setGame is refused unless the round is IDLE', () => {
  const state = newState()
  state.round.phase = 'ARMED'
  applyHostAction(state, { a: 'setGame', id: 'trivia', options: {} })
  assert.equal(state.round.phase, 'ARMED')
})

test('loadState backfills snapshots from before game modes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-state-'))
  try {
    const path = join(dir, 'state.json')
    const old = {
      mode: 'solo',
      players: [{ id: 'p1', name: 'Ada', connected: true }],
      teams: [],
      scores: { p1: 700 },
      round: { value: 100, phase: 'LOCKED', armedAt: 5, order: [], total: 0, lockedOut: [] },
    }
    writeFileSync(path, JSON.stringify(old))
    const loaded = loadState(path)
    assert.equal(loaded.game.id, 'trivia')
    assert.deepEqual(loaded.items, {})
    assert.deepEqual(loaded.effects, [])
    assert.equal(loaded.scores.p1, 700)
    assert.equal(loaded.round.phase, 'IDLE', 'the standing mid-flight reset still applies')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadState falls back to trivia when the snapshot names an unregistered game', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-state-'))
  try {
    const path = join(dir, 'state.json')
    const state = newState() as State & { game: { id: string } }
    state.game.id = 'showdown'
    writeFileSync(path, JSON.stringify(state))
    assert.equal(loadState(path).game.id, 'trivia')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('loadState orphans round.candidates along with the duel that explained it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-state-'))
  try {
    const path = join(dir, 'state.json')
    const state = newState()
    state.duel = { rule: 'host-pick', pool: [], missed: [], seated: ['a', 'b'] }
    state.round.candidates = ['a', 'b']
    writeFileSync(path, JSON.stringify(state))
    const loaded = loadState(path)
    assert.equal(loaded.duel, undefined)
    assert.equal(
      loaded.round.candidates,
      undefined,
      'a restart must not boot with two ids silently the only ones who can buzz',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('setMirror flips the phone mirror and defaults off', () => {
  const state = newState()
  assert.equal(state.mirrorFragments, false)
  applyHostAction(state, { a: 'setMirror', on: true })
  assert.equal(state.mirrorFragments, true)
})

test('loadState backfills the addendum fields on an older snapshot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pb-'))
  const path = join(dir, 'state.json')
  const old = newState() as Record<string, unknown>
  delete old.packs
  delete old.mirrorFragments
  writeFileSync(path, JSON.stringify(old))
  const loaded = loadState(path)
  assert.deepEqual(loaded.packs, [])
  assert.equal(loaded.mirrorFragments, false)
  assert.equal(loaded.reading, undefined)
})

test('setAnswerWindow clamps to 0..120 whole seconds', () => {
  const state = newState()
  applyHostAction(state, { a: 'setAnswerWindow', sec: 45.7 })
  assert.equal(state.answerWindowSec, 46)
  applyHostAction(state, { a: 'setAnswerWindow', sec: -3 })
  assert.equal(state.answerWindowSec, 0)
  applyHostAction(state, { a: 'setAnswerWindow', sec: 9999 })
  assert.equal(state.answerWindowSec, 120)
})

test('arm sweeps the judge window and the last spoken answer', () => {
  const state = newState()
  state.round.judge = { until: 123 }
  state.round.spoken = { name: 'Ada', transcript: 'vermont', hit: true }
  applyHostAction(state, { a: 'arm' })
  assert.equal(state.round.judge, undefined)
  assert.equal(state.round.spoken, undefined)
})

test('a verdict ends the window but the transcript rides out the rebound', () => {
  const state = newState()
  state.players = [{ id: 'a', name: 'Ada', connected: true }]
  applyHostAction(state, { a: 'arm' })
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'a', name: 'Ada', at: state.round.armedAt, deltaMs: 0 }]
  state.round.judge = {}
  state.round.spoken = { name: 'Ada', transcript: 'vermont', hit: false }
  applyHostAction(state, { a: 'wrong', neg: 100 })
  assert.equal(state.round.judge, undefined, 'the window is over')
  assert.deepEqual(state.round.spoken, { name: 'Ada', transcript: 'vermont', hit: false })
})

test('next clears both', () => {
  const state = newState()
  state.round.judge = {}
  state.round.spoken = { name: 'Ada', transcript: 'x', hit: true }
  applyHostAction(state, { a: 'next' })
  assert.equal(state.round.judge, undefined)
  assert.equal(state.round.spoken, undefined)
})
