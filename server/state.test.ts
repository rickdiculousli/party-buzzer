import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyHostAction, buzzBlockReason, loadState, newState } from './state.ts'
import { duelCatalog } from './duel.ts'
import { persistedSnapshot } from './snapshot.ts'
import { catalog } from './modes/index.ts'
import { refuses } from '../shared/legality.ts'
import { momentOf, type Local } from '../shared/wall.ts'
import type { HostAction, SetlistBlock, State } from '../shared/protocol.ts'

function withPlayer(state: State): string {
  state.players.push({ id: 'p1', name: 'Ada', connected: true })
  state.scores.p1 = 300
  return 'p1'
}

test('question identity survives a rebound while attempts change even at the same timestamp', (t) => {
  t.mock.method(Date, 'now', () => 1000)
  const state = newState()
  withPlayer(state)
  applyHostAction(state, { a: 'arm' })
  const { questionId, attemptId, armedAt } = state.round
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'p1', name: 'Ada', at: armedAt, deltaMs: 0 }]
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.equal(state.round.questionId, questionId)
  assert.notEqual(state.round.attemptId, attemptId)
  assert.equal(state.round.armedAt, armedAt, 'identity does not depend on elapsed time')
  applyHostAction(state, { a: 'arm' })
  assert.notEqual(state.round.questionId, questionId)
  applyHostAction(state, { a: 'next' })
  assert.equal(state.round.questionId, '')
})

test('arm sweeps last question\'s effects and stamps the live ones', () => {
  const state = newState()
  state.effects = [
    { kind: 'frozen', playerId: 'old', attemptId: 'old' },
    { kind: 'frozen', playerId: 'fresh' },
  ]
  applyHostAction(state, { a: 'arm' })
  assert.deepEqual(
    state.effects,
    [{ kind: 'frozen', playerId: 'fresh', attemptId: state.round.attemptId }],
  )
})

test('a wrong rebound re-stamps effects to the new arm instead of sweeping them', () => {
  const state = newState()
  withPlayer(state)
  state.effects = [{ kind: 'frozen', playerId: 'p1', attemptId: state.round.attemptId }]
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: 'p1', name: 'Ada', at: 1, deltaMs: 0 }]
  applyHostAction(state, { a: 'wrong', neg: 0 })
  assert.equal(state.round.phase, 'ARMED')
  assert.equal(state.effects.length, 1)
  assert.equal(state.effects[0].attemptId, state.round.attemptId)
})

test('buzzBlockReason bars a frozen player for exactly the stamped round', () => {
  const state = newState()
  state.round.phase = 'ARMED'
  state.round.attemptId = 'current'
  state.effects = [{ kind: 'frozen', playerId: 'p1', attemptId: 'current' }]
  assert.equal(buzzBlockReason(state, 'p1'), 'frozen')
  assert.equal(buzzBlockReason(state, 'p2'), null)
  state.effects[0].attemptId = 'other'
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

test('setMode with the current id updates options and keeps scores', () => {
  const state = newState()
  withPlayer(state)
  applyHostAction(state, { a: 'setMode', id: 'trivia', options: {} })
  assert.equal(state.scores.p1, 300)
  assert.equal(state.game.id, 'trivia')
})

test('setMode with an unknown id is dropped, logged, and changes nothing', () => {
  const state = newState()
  withPlayer(state)
  applyHostAction(state, { a: 'setMode', id: 'nope', options: {} })
  assert.equal(state.game.id, 'trivia')
  assert.equal(state.scores.p1, 300)
})

test('setMode is refused unless the round is IDLE', () => {
  const state = newState()
  state.round.phase = 'ARMED'
  applyHostAction(state, { a: 'setMode', id: 'trivia', options: {} })
  assert.equal(state.round.phase, 'ARMED')
})

test('loadState backfills snapshots from before game modes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-state-'))
  try {
    const path = join(dir, 'state.json')
    const old = {
      grouping: 'solo',
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

test('loadState orphans round.buzzable along with the duel that explained it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzzer-state-'))
  try {
    const path = join(dir, 'state.json')
    const state = newState()
    state.duel = { rule: 'host-pick', pool: [], missed: [], seated: ['a', 'b'] }
    state.round.buzzable = ['a', 'b']
    writeFileSync(path, JSON.stringify(state))
    const loaded = loadState(path)
    assert.equal(loaded.duel, undefined)
    assert.equal(
      loaded.round.buzzable,
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

test('setMode keeps the standings when the setlist asks it to', () => {
  const state = newState()
  state.scores = { ada: 300 }
  state.items = { ada: ['shield'] }
  applyHostAction(state, { a: 'setMode', id: 'quizbowl', options: {}, keepScores: true })
  assert.equal(state.game.id, 'quizbowl')
  assert.deepEqual(state.scores, { ada: 300 })
  assert.deepEqual(state.items, {})
})

test('a host switching modes by hand still wipes the standings', () => {
  const state = newState()
  state.scores = { ada: 300 }
  applyHostAction(state, { a: 'setMode', id: 'quizbowl', options: {} })
  assert.deepEqual(state.scores, {})
})

const LOCAL: Local = { open: false, settled: true, retired: true }

const setlistBlocks: SetlistBlock[] = [
  { game: 'trivia', options: {}, count: 2, value: 100 },
  { game: 'quizbowl', options: {}, count: 1, duel: 'vote' },
]

function playRound(state: State): void {
  if (state.arrival) applyHostAction(state, { a: 'closeArrival', arrivalId: state.arrival.id })
  applyHostAction(state, { a: 'arm' })
  applyHostAction(state, { a: 'next' })
}

test('next spends a question; a second next on a dead round spends nothing', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  playRound(state)
  assert.deepEqual([state.setlist!.at, state.setlist!.done], [0, 1])
  applyHostAction(state, { a: 'next' })
  assert.deepEqual([state.setlist!.at, state.setlist!.done], [0, 1])
})

test('resetRound takes a question back rather than spending it', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  applyHostAction(state, { a: 'arm' })
  applyHostAction(state, { a: 'resetRound' })
  assert.equal(state.setlist!.done, 0)
})

test('rolling into a duel block switches the mode and opens the duel', () => {
  const state = newState()
  state.players = [
    { id: 'a', name: 'Ada', connected: true },
    { id: 'b', name: 'Bo', connected: true },
  ]
  state.scores = { a: 300 }
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  playRound(state)
  playRound(state)
  assert.equal(state.setlist!.at, 1)
  assert.equal(state.game.id, 'quizbowl')
  assert.equal(state.duel?.rule, 'vote')
  assert.deepEqual(state.scores, { a: 300 }, 'the standings cross the boundary')
})

test('editing the setlist mid-block keeps the position', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  playRound(state)
  const longer: SetlistBlock[] = [{ ...setlistBlocks[0], count: 5 }, setlistBlocks[1]]
  applyHostAction(state, { a: 'setSetlist', blocks: longer })
  assert.deepEqual([state.setlist!.at, state.setlist!.done], [0, 1])
})

test('setSetlist that changes the mode of the currently-played block re-applies it', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  assert.equal(state.game.id, 'trivia')
  assert.equal(state.round.value, 100)
  const changed: SetlistBlock[] = [
    { game: 'quizbowl', options: {}, count: 2, value: 250 },
    setlistBlocks[1],
  ]
  applyHostAction(state, { a: 'setSetlist', blocks: changed })
  assert.equal(state.game.id, 'quizbowl', 'the play strip and the room agree')
  assert.equal(state.round.value, 250)
  assert.deepEqual([state.setlist!.at, state.setlist!.done], [0, 0], 'position untouched')
})

test('setSetlist that changes only a later block does not re-apply anything', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  playRound(state)
  const laterChanged: SetlistBlock[] = [
    setlistBlocks[0],
    { ...setlistBlocks[1], value: 999 },
  ]
  applyHostAction(state, { a: 'setSetlist', blocks: laterChanged })
  assert.equal(state.game.id, 'trivia', 'still on the untouched current block')
  assert.equal(state.round.value, 100)
  assert.equal(state.duel, undefined, 'the later block\'s duel did not fire early')
  assert.deepEqual([state.setlist!.at, state.setlist!.done], [0, 1])
})

test('setSetlist that changes the current block while a duel is open does not touch the duel', () => {
  const state = newState()
  state.players = [
    { id: 'a', name: 'Ada', connected: true },
    { id: 'b', name: 'Bo', connected: true },
  ]
  const duelBlocks: SetlistBlock[] = [
    { game: 'quizbowl', options: {}, count: 3, duel: 'vote' },
  ]
  applyHostAction(state, { a: 'setSetlist', blocks: duelBlocks })
  assert.equal(state.duel?.rule, 'vote')
  state.duel!.pool.push({ playerId: 'a', votes: ['b'], in: true })
  const changed: SetlistBlock[] = [{ ...duelBlocks[0], count: 5 }]
  applyHostAction(state, { a: 'setSetlist', blocks: changed })
  assert.deepEqual(
    state.duel!.pool,
    [{ playerId: 'a', votes: ['b'], in: true }],
    'the pool survives an unrelated tweak',
  )
  assert.deepEqual([state.setlist!.at, state.setlist!.done], [0, 0])
})

test('a setlist too short for the position restarts it', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  playRound(state)
  playRound(state)
  assert.equal(state.setlist!.at, 1)
  applyHostAction(state, { a: 'setSetlist', blocks: [setlistBlocks[0]] })
  assert.deepEqual([state.setlist!.at, state.setlist!.done], [0, 0])
})

test('setlistJump clamps, resets the count, and re-enters the block', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  applyHostAction(state, { a: 'setlistJump', at: 99 })
  assert.deepEqual([state.setlist!.at, state.setlist!.done], [2, 0], 'clamped to the end')
  applyHostAction(state, { a: 'setlistJump', at: 0 })
  assert.equal(state.game.id, 'trivia')
  assert.equal(state.round.value, 100)
})

test('clearSetlist drops the setlist and leaves the game alone', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  applyHostAction(state, { a: 'setlistJump', at: 1 })
  assert.equal(state.game.id, 'quizbowl')
  const valueBefore = state.round.value
  applyHostAction(state, { a: 'clearSetlist' })
  assert.equal(state.setlist, undefined)
  assert.equal(state.game.id, 'quizbowl', 'clearing the setlist is not a mode change')
  assert.equal(state.duel?.rule, 'vote', 'nor a reason to cancel an open duel')
  assert.equal(state.round.value, valueBefore, 'nor a reason to reset the round value')
})

test('an empty setSetlist is a clearSetlist', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  applyHostAction(state, { a: 'setSetlist', blocks: [] })
  assert.equal(state.setlist, undefined)
})

test('the setlist actions are refused mid-question, the way setMode is', () => {
  const state = newState()
  applyHostAction(state, { a: 'arm' })
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  assert.equal(state.setlist, undefined)
})

test('setSetlist onto a spent setlist restarts at 0/0 and enters the first block fresh', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 1 }] })
  playRound(state)
  assert.equal(state.setlist!.at, 1, 'the one-block setlist is spent')
  const next: SetlistBlock[] = [
    { game: 'quizbowl', options: {}, count: 1 },
    { game: 'trivia', options: {}, count: 1 },
  ]
  applyHostAction(state, { a: 'setSetlist', blocks: next })
  assert.deepEqual([state.setlist!.at, state.setlist!.done], [0, 0])
  assert.equal(state.game.id, 'quizbowl', 'the first block of the new setlist was actually entered')
})

test('setSetlist routes through sanitizeBlocks: an unknown game is dropped, a NaN count clamps to 1', () => {
  const state = newState()
  applyHostAction(state, {
    a: 'setSetlist',
    blocks: [
      { game: 'nope', options: {}, count: 1 },
      { game: 'trivia', options: {}, count: NaN },
    ] as unknown as SetlistBlock[],
  })
  assert.equal(state.setlist!.blocks.length, 1, 'the unknown-game block was dropped')
  assert.equal(state.setlist!.blocks[0].game, 'trivia')
  assert.equal(state.setlist!.blocks[0].count, 1, 'the NaN count clamped to 1')
})

test('a stray rebound changes nothing, and a penalised question is still judgeable', () => {
  const state = newState()
  const id = withPlayer(state)
  state.round.phase = 'ARMED'
  state.round.order = [{ playerId: id, name: 'Ada', at: 1, deltaMs: 0 }]

  const before = structuredClone(state.round)
  applyHostAction(state, { a: 'rebound' })
  assert.deepEqual(state.round, before, 'no hold, no change')

  state.round.phase = 'LOCKED'
  state.round.award = { name: 'Bo', points: -400 }
  applyHostAction(state, { a: 'correct' })
  assert.equal(state.scores[id], 300 + state.round.value, 'the retake scores')
  assert.equal(state.round.award?.name, 'Ada', 'and the award is hers now')
})

const ROOMS: Record<string, () => State> = {
  idle: () => {
    const s = room()
    s.round.armedAt = 1000
    s.round.award = { name: 'Ada', points: 100 }
    return s
  },
  armed: () => {
    const s = room()
    s.round.phase = 'ARMED'
    s.round.armedAt = 1000
    return s
  },
  locked: () => {
    const s = room()
    s.round.phase = 'LOCKED'
    s.round.armedAt = 1000
    s.round.order = [{ playerId: 'p1', name: 'Ada', at: 1100, deltaMs: 0 }]
    s.round.total = 1
    return s
  },
  scored: () => {
    const s = room()
    s.round.phase = 'LOCKED'
    s.round.armedAt = 1000
    s.round.order = [{ playerId: 'p1', name: 'Ada', at: 1100, deltaMs: 0 }]
    s.round.total = 1
    s.round.award = { name: 'Ada', points: 100 }
    return s
  },
  held: () => {
    const s = room()
    s.round.phase = 'LOCKED'
    s.round.armedAt = 1000
    s.round.held = true
    s.round.award = { name: 'Ada', points: -100, penalty: true }
    s.round.lockedOut = ['p1']
    return s
  },
  'duel open': () => {
    const s = room()
    s.duel = { rule: 'vote', pool: [{ playerId: 'p1', votes: ['p2'], in: true }], missed: [] }
    return s
  },
  'duel seated': () => {
    const s = room()
    s.duel = { rule: 'vote', pool: [], missed: [], seated: ['p1', 'p2'] }
    s.round.buzzable = ['p1', 'p2']
    return s
  },
  'duel seated mid-question': () => {
    const s = room()
    s.duel = { rule: 'vote', pool: [], missed: [], seated: ['p1', 'p2'] }
    s.round.phase = 'LOCKED'
    s.round.armedAt = 1000
    s.round.buzzable = ['p1', 'p2']
    s.round.order = [{ playerId: 'p1', name: 'Ada', at: 1100, deltaMs: 0 }]
    s.round.total = 1
    return s
  },
  setlist: () => {
    const s = room()
    s.round.armedAt = 1000
    s.setlist = {
      blocks: [
        { game: 'trivia', options: {}, count: 2, value: 100 },
        { game: 'quizbowl', options: {}, count: 1 },
      ],
      at: 0,
      done: 1,
    }
    return s
  },
}

function room(): State {
  const s = newState()
  s.games = catalog()
  s.duelRules = duelCatalog()
  s.players = [
    { id: 'p1', name: 'Ada', connected: true },
    { id: 'p2', name: 'Bo', connected: true },
  ]
  s.scores = { p1: 300, p2: 100 }
  return s
}

const ACTIONS: HostAction[] = [
  { a: 'arm' },
  { a: 'correct' },
  { a: 'wrong', neg: 100 },
  { a: 'rebound' },
  { a: 'next' },
  { a: 'resetRound' },
  { a: 'undo' },
  { a: 'setValue', value: 400 },
  { a: 'setAnswerWindow', sec: 30 },
  { a: 'setScore', key: 'p1', score: 900 },
  { a: 'rename', playerId: 'p1', name: 'Zed' },
  { a: 'kick', playerId: 'p2' },
  { a: 'setGrouping', grouping: 'teams' },
  { a: 'addTeam', name: 'Red', color: '#f00' },
  { a: 'assign', playerId: 'p1', teamId: 't1' },
  { a: 'setMode', id: 'quizbowl', options: {} },
  { a: 'setMirror', on: true },
  { a: 'setAutoplay', on: true, nextSec: 3, buzzSec: 3, reboundSec: 2, introSec: 12 },
  { a: 'openDuel', rule: 'host-pick' },
  { a: 'openDuel', rule: 'nonsense' },
  { a: 'closeDuel', playerIds: ['p1', 'p2'] },
  { a: 'cancelDuel' },
  { a: 'setSetlist', blocks: [{ game: 'quizbowl', options: {}, count: 3 }] },
  { a: 'setlistJump', at: 1 },
  { a: 'clearSetlist' },
]

function inertlyLegal(s: State, a: HostAction): string | null {
  if (a.a === 'undo') return 'the hub owns undo'
  if (a.a === 'cancelDuel' && !s.duel && !s.round.buzzable) return 'no duel to cancel'
  if (a.a === 'clearSetlist' && !s.setlist) return 'no setlist to clear'
  return null
}

test('every action the table allows actually does something', () => {
  for (const [where, build] of Object.entries(ROOMS)) {
    for (const action of ACTIONS) {
      const state = build()
      if (refuses(state, action)) continue
      const before = structuredClone(state)
      applyHostAction(state, action)
      const inert = inertlyLegal(before, action)
      if (inert) {
        assert.deepEqual(state, before, `${action.a} in "${where}" (${inert}) should be inert`)
        continue
      }
      assert.notDeepEqual(
        state,
        before,
        `${action.a} in "${where}": the table allows it and the server changed nothing`,
      )
    }
  }
})

test('every action the table refuses is refused by the server too', () => {
  for (const [where, build] of Object.entries(ROOMS)) {
    for (const action of ACTIONS) {
      const state = build()
      const why = refuses(state, action)
      if (!why) continue
      const before = structuredClone(state)
      applyHostAction(state, action)
      assert.deepEqual(
        state,
        before,
        `${action.a} in "${where}": the table refuses it (${why}) and the server did it anyway`,
      )
    }
  }
})

test('next and a jump to the end stamp the finale clock; a jump back clears it', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  const before = Date.now()
  playRound(state)
  assert.equal(state.setlist!.spentAt, undefined)
  playRound(state)
  playRound(state)
  assert.equal(state.setlist!.at, 2, 'spent')
  const stamped = state.setlist!.spentAt!
  assert.ok(stamped >= before, 'next stamps the spend')
  applyHostAction(state, { a: 'setlistJump', at: 0 })
  assert.equal(state.setlist!.spentAt, undefined)
  const result = applyHostAction(state, { a: 'setlistJump', at: setlistBlocks.length })
  assert.equal(result.status, 'applied')
  assert.ok(state.setlist!.spentAt! >= stamped, 'Replay finale re-stamps')
})

test('a disk file with a spent setlist and no stamp loads as a settled finale', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  applyHostAction(state, { a: 'setlistJump', at: setlistBlocks.length })
  const file = persistedSnapshot(state)
  assert.equal(file.state.setlist!.spentAt, state.setlist!.spentAt, 'the stamp rides the disk file')
  delete file.state.setlist!.spentAt
  ;(file.state.setlist as { spentAt?: unknown }).spentAt = 'yesterday'
  const dir = mkdtempSync(join(tmpdir(), 'pb-state-'))
  const path = join(dir, 'state.json')
  writeFileSync(path, JSON.stringify(file))
  const loaded = loadState(path)
  assert.equal(loaded.setlist!.at, setlistBlocks.length)
  assert.equal(loaded.setlist!.spentAt, undefined, 'a stamp that is not a number is dropped')
  rmSync(dir, { recursive: true })
})

test('a jump to the end drops the question on the wall, so the finale is up when its clock starts', () => {
  const state = newState()
  applyHostAction(state, { a: 'setSetlist', blocks: setlistBlocks })
  if (state.arrival) applyHostAction(state, { a: 'closeArrival', arrivalId: state.arrival.id })
  applyHostAction(state, { a: 'arm' })
  state.round.phase = 'IDLE'
  state.round.spoken = { name: 'Ada', transcript: 'no idea', hit: false }
  state.typed = 'Who painted it?'
  assert.equal(momentOf(state, LOCAL), 'verdict:unanswered')
  applyHostAction(state, { a: 'setlistJump', at: setlistBlocks.length })
  assert.equal(momentOf(state, LOCAL), 'idle:finale')
  assert.deepEqual([state.round.questionId, state.round.spoken, state.typed], ['', undefined, undefined])
  const stamped = state.setlist!.spentAt!
  assert.ok(stamped > 0)
  applyHostAction(state, { a: 'next' })
  assert.equal(state.setlist!.spentAt, stamped)
})
