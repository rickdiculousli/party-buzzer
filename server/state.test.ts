import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyHostAction, buzzBlockReason, loadState, newState } from './state.ts'
import type { FlowBlock, State } from '../shared/protocol.ts'

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

test('setGame keeps the standings when the flow asks it to', () => {
  const state = newState()
  state.scores = { ada: 300 }
  state.items = { ada: ['shield'] }
  applyHostAction(state, { a: 'setGame', id: 'quizbowl', options: {}, keepScores: true })
  assert.equal(state.game.id, 'quizbowl')
  assert.deepEqual(state.scores, { ada: 300 })
  // Items and effects are mode-flavoured and reset either way.
  assert.deepEqual(state.items, {})
})

test('a host switching modes by hand still wipes the standings', () => {
  const state = newState()
  state.scores = { ada: 300 }
  applyHostAction(state, { a: 'setGame', id: 'quizbowl', options: {} })
  assert.deepEqual(state.scores, {})
})

const flowBlocks: FlowBlock[] = [
  { game: 'trivia', options: {}, count: 2, value: 100 },
  { game: 'quizbowl', options: {}, count: 1, duel: 'vote' },
]

/** A round that was actually played, so `next` counts it. */
function playRound(state: State): void {
  applyHostAction(state, { a: 'arm' })
  applyHostAction(state, { a: 'next' })
}

test('next spends a question; a second next on a dead round spends nothing', () => {
  const state = newState()
  applyHostAction(state, { a: 'setFlow', blocks: flowBlocks })
  playRound(state)
  assert.deepEqual([state.flow!.at, state.flow!.done], [0, 1])
  applyHostAction(state, { a: 'next' })
  assert.deepEqual([state.flow!.at, state.flow!.done], [0, 1])
})

test('resetRound takes a question back rather than spending it', () => {
  const state = newState()
  applyHostAction(state, { a: 'setFlow', blocks: flowBlocks })
  applyHostAction(state, { a: 'arm' })
  applyHostAction(state, { a: 'resetRound' })
  assert.equal(state.flow!.done, 0)
})

test('rolling into a duel block switches the mode and opens the duel', () => {
  const state = newState()
  state.players = [
    { id: 'a', name: 'Ada', connected: true },
    { id: 'b', name: 'Bo', connected: true },
  ]
  state.scores = { a: 300 }
  applyHostAction(state, { a: 'setFlow', blocks: flowBlocks })
  playRound(state)
  playRound(state)
  assert.equal(state.flow!.at, 1)
  assert.equal(state.game.id, 'quizbowl')
  assert.equal(state.duel?.rule, 'vote')
  assert.deepEqual(state.scores, { a: 300 }, 'the standings cross the boundary')
})

test('editing the setlist mid-block keeps the position', () => {
  const state = newState()
  applyHostAction(state, { a: 'setFlow', blocks: flowBlocks })
  playRound(state)
  const longer: FlowBlock[] = [{ ...flowBlocks[0], count: 5 }, flowBlocks[1]]
  applyHostAction(state, { a: 'setFlow', blocks: longer })
  assert.deepEqual([state.flow!.at, state.flow!.done], [0, 1])
})

test('a setlist too short for the position restarts it', () => {
  const state = newState()
  applyHostAction(state, { a: 'setFlow', blocks: flowBlocks })
  playRound(state)
  playRound(state)
  assert.equal(state.flow!.at, 1)
  applyHostAction(state, { a: 'setFlow', blocks: [flowBlocks[0]] })
  assert.deepEqual([state.flow!.at, state.flow!.done], [0, 0])
})

test('flowJump clamps, resets the count, and re-enters the block', () => {
  const state = newState()
  applyHostAction(state, { a: 'setFlow', blocks: flowBlocks })
  applyHostAction(state, { a: 'flowJump', at: 99 })
  assert.deepEqual([state.flow!.at, state.flow!.done], [2, 0], 'clamped to the end')
  applyHostAction(state, { a: 'flowJump', at: 0 })
  assert.equal(state.game.id, 'trivia')
  assert.equal(state.round.value, 100)
})

test('clearFlow drops the setlist and leaves the game alone', () => {
  const state = newState()
  applyHostAction(state, { a: 'setFlow', blocks: flowBlocks })
  applyHostAction(state, { a: 'flowJump', at: 1 })
  assert.equal(state.game.id, 'quizbowl')
  applyHostAction(state, { a: 'clearFlow' })
  assert.equal(state.flow, undefined)
  assert.equal(state.game.id, 'quizbowl', 'clearing the setlist is not a mode change')
  assert.equal(state.duel?.rule, 'vote', 'nor a reason to cancel an open duel')
})

test('an empty setFlow is a clearFlow', () => {
  const state = newState()
  applyHostAction(state, { a: 'setFlow', blocks: flowBlocks })
  applyHostAction(state, { a: 'setFlow', blocks: [] })
  assert.equal(state.flow, undefined)
})

test('the flow actions are refused mid-question, the way setGame is', () => {
  const state = newState()
  applyHostAction(state, { a: 'arm' })
  applyHostAction(state, { a: 'setFlow', blocks: flowBlocks })
  assert.equal(state.flow, undefined)
})
