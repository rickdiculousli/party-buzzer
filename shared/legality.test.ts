import test from 'node:test'
import assert from 'node:assert/strict'
import { refuses, type Refusal } from './legality.ts'
import type { HostAction, State } from './protocol.ts'

function room(): State {
  return {
    grouping: 'solo',
    readingActive: false,
    players: [
      { id: 'a', name: 'Ada', connected: true },
      { id: 'b', name: 'Bo', connected: true },
    ],
    teams: [],
    scores: { a: 0, b: 0 },
    round: { questionId: '', attemptId: '', value: 200, phase: 'IDLE', armedAt: 0, order: [], total: 0, lockedOut: [] },
    game: { id: 'trivia', options: {}, moduleState: null },
    items: {},
    effects: [],
    games: [],
    duelRules: [],
    setlists: [],
    packs: [],
    packSizes: {},
    packCost: {},
    mirrorFragments: false,
    answerWindowSec: 0,
    choiceSec: 20,
    revealSec: 10,
    autoplay: { on: false, nextSec: 4, buzzSec: 4, reboundSec: 3, introSec: 12 },
  }
}

function locked(s: State): State {
  s.round.phase = 'LOCKED'
  s.round.armedAt = 1000
  s.round.order = [{ playerId: 'a', name: 'Ada', at: 1100, deltaMs: 0 }]
  s.round.total = 1
  return s
}

function intro(s: State): State {
  s.arrival = { kind: 'introduction', id: 'intro-1', blockAt: 0, blockKey: '0:trivia' }
  return s
}

const LEGAL: Record<HostAction['a'], [State, HostAction]> = {
  arm: [room(), { a: 'arm' }],
  correct: [locked(room()), { a: 'correct' }],
  wrong: [locked(room()), { a: 'wrong', neg: 100 }],
  rebound: [(() => {
    const s = locked(room())
    s.round.held = true
    return s
  })(), { a: 'rebound' }],
  timeUp: [(() => {
    const s = room()
    s.round.phase = 'ARMED'
    return s
  })(), { a: 'timeUp' }],
  next: [locked(room()), { a: 'next' }],
  resetRound: [locked(room()), { a: 'resetRound' }],
  undo: [locked(room()), { a: 'undo' }],
  setValue: [locked(room()), { a: 'setValue', value: 400 }],
  setAnswerWindow: [locked(room()), { a: 'setAnswerWindow', sec: 10 }],
  setChoiceTime: [locked(room()), { a: 'setChoiceTime', sec: 20 }],
  setRevealTime: [locked(room()), { a: 'setRevealTime', sec: 10 }],
  settleChoice: [(() => {
    const s = room()
    s.round.phase = 'ARMED'
    s.round.kind = 'choice'
    s.round.choices = ['a', 'b']
    return s
  })(), { a: 'settleChoice', correct: 1 }],
  settleClosest: [(() => {
    const s = room()
    s.round.phase = 'ARMED'
    s.round.kind = 'closest'
    s.round.guessing = { closesAt: 1 }
    return s
  })(), { a: 'settleClosest', truth: 1665 }],
  setScore: [locked(room()), { a: 'setScore', key: 'a', score: 300 }],
  rename: [locked(room()), { a: 'rename', playerId: 'a', name: 'Ada L' }],
  kick: [locked(room()), { a: 'kick', playerId: 'b' }],
  setGrouping: [room(), { a: 'setGrouping', grouping: 'teams' }],
  addTeam: [locked(room()), { a: 'addTeam', name: 'Red', color: '#f00' }],
  assign: [locked(room()), { a: 'assign', playerId: 'a', teamId: 't' }],
  setMode: [room(), { a: 'setMode', id: 'quizbowl', options: {} }],
  setMirror: [locked(room()), { a: 'setMirror', on: true }],
  setAutoplay: [locked(room()), { a: 'setAutoplay', on: true, nextSec: 5, buzzSec: 5, reboundSec: 4, introSec: 12 }],
  clearNight: [locked(room()), { a: 'clearNight' }],
  openDuel: [room(), { a: 'openDuel', rule: 'vote' }],
  closeDuel: [(() => {
    const s = room()
    s.duel = { rule: 'vote', pool: [], missed: [] }
    return s
  })(), { a: 'closeDuel' }],
  cancelDuel: [locked(room()), { a: 'cancelDuel' }],
  setSetlist: [room(), { a: 'setSetlist', blocks: [] }],
  setlistJump: [(() => {
    const s = room()
    s.setlist = { blocks: [{ game: 'trivia', options: {}, count: 3 }], at: 0, done: 0 }
    return s
  })(), { a: 'setlistJump', at: 0 }],
  clearSetlist: [room(), { a: 'clearSetlist' }],
  prepareMinigame: [room(), { a: 'prepareMinigame', id: 'bow', options: {} }],
  startMinigame: [(() => {
    const s = room()
    s.players = [{ id: 'a', name: 'Ada', connected: true }]
    return s
  })(), { a: 'startMinigame' }],
  cancelMinigame: [room(), { a: 'cancelMinigame' }],
  closeMinigame: [room(), { a: 'closeMinigame' }],
  openLobby: [room(), { a: 'openLobby' }],
  closeArrival: [intro(room()), { a: 'closeArrival', arrivalId: 'intro-1' }],
}

test('every action kind has a shape it is legal in', () => {
  for (const [kind, [s, a]] of Object.entries(LEGAL)) {
    assert.equal(refuses(s, a), null, `${kind} should be legal here, got ${refuses(s, a)}`)
  }
})

const REFUSED: [Refusal, State, HostAction][] = [
  ['no-choice', locked(room()), { a: 'settleChoice', correct: 0 }],
  ['no-guessing', locked(room()), { a: 'settleClosest', truth: 10 }],
  ['not-open', locked(room()), { a: 'timeUp' }],
  ['not-idle', locked(room()), { a: 'setMode', id: 'trivia', options: {} }],
  ['not-idle', locked(room()), { a: 'openDuel', rule: 'vote' }],
  ['not-idle', locked(room()), { a: 'setSetlist', blocks: [] }],
  ['not-idle', locked(room()), { a: 'setlistJump', at: 1 }],
  ['not-idle', locked(room()), { a: 'clearSetlist' }],
  ['not-idle', (() => {
    const s = locked(room())
    s.duel = { rule: 'vote', pool: [], missed: [] }
    return s
  })(), { a: 'closeDuel' }],

  ['no-leader', room(), { a: 'correct' }],
  ['no-leader', room(), { a: 'wrong', neg: 100 }],
  ['no-leader', (() => {
    const s = locked(room())
    s.round.phase = 'COLLECTING'
    return s
  })(), { a: 'correct' }],
  ['no-leader', (() => {
    const s = locked(room())
    s.round.order = []
    return s
  })(), { a: 'correct' }],

  ['already-scored', (() => {
    const s = locked(room())
    s.round.award = { name: 'Ada', points: 200 }
    return s
  })(), { a: 'correct' }],

  ['nothing-held', room(), { a: 'rebound' }],
  ['no-duel', room(), { a: 'closeDuel' }],
  ['duel-seated', (() => {
    const s = room()
    s.duel = { rule: 'vote', pool: [], missed: [], seated: ['a', 'b'] }
    return s
  })(), { a: 'closeDuel' }],
  ['duel-seated', (() => {
    const s = locked(room())
    s.duel = { rule: 'vote', pool: [], missed: [], seated: ['a', 'b'] }
    return s
  })(), { a: 'closeDuel' }],
  ['unknown-duel-rule', (() => {
    const s = room()
    s.duelRules = [{ id: 'vote', name: 'Room votes', entry: 'vote', resolve: 'votes' }]
    return s
  })(), { a: 'openDuel', rule: 'arm-wrestle' }],
  ['unknown-mode', (() => {
    const s = room()
    s.games = [{ id: 'trivia', name: 'Trivia', options: [] }]
    return s
  })(), { a: 'setMode', id: 'buzzword-bingo', options: {} }],
  ['no-setlist', room(), { a: 'setlistJump', at: 1 }],
  ['no-players', (() => {
    const s = room()
    for (const player of s.players) player.connected = false
    return s
  })(), { a: 'startMinigame' }],
  ['minigame-active', (() => {
    const s = room()
    s.minigame = { id: 'bow', matchId: 'm', phase: 'ready', options: { durationSec: 40, reloadMs: 700, seed: 1 }, participants: [] }
    return s
  })(), { a: 'arm' }],

  ['introduction-active', intro(room()), { a: 'arm' }],
  ['introduction-active', intro(room()), { a: 'prepareMinigame', id: 'bow', options: {} }],
  ['introduction-active', intro(room()), { a: 'openLobby' }],
  ['reading-active', (() => {
    const s = room()
    s.readingActive = true
    return s
  })(), { a: 'openLobby' }],
  ['duel-active', (() => {
    const s = room()
    s.duel = { rule: 'vote', pool: [], missed: [] }
    return s
  })(), { a: 'openLobby' }],
  ['not-idle', locked(room()), { a: 'openLobby' }],
  ['arrival-changed', intro(room()), { a: 'closeArrival', arrivalId: 'intro-0' }],
  ['arrival-changed', room(), { a: 'closeArrival', arrivalId: 'intro-1' }],
]

test('each code comes back from the shape that earns it', () => {
  for (const [code, s, a] of REFUSED) {
    assert.equal(refuses(s, a), code, `${a.a} in this shape should refuse ${code}`)
  }
})

test('arming a LOCKED round stays legal', () => {
  assert.equal(refuses(locked(room()), { a: 'arm' }), null)
  const armed = room()
  armed.round.phase = 'ARMED'
  assert.equal(refuses(armed, { a: 'arm' }), null, 'and the table has no opinion on an open one either')
})

test('every code in the union is covered by a case', () => {
  const codes: Refusal[] = [
    'not-idle', 'no-leader', 'already-scored', 'nothing-held',
    'no-duel', 'duel-seated', 'unknown-mode', 'unknown-duel-rule', 'no-setlist', 'no-players', 'minigame-active',
    'arrival-changed', 'introduction-active', 'reading-active', 'duel-active',
  ]
  const seen = new Set(REFUSED.map(([code]) => code))
  for (const code of codes) assert.ok(seen.has(code), `no case refuses ${code}`)
})

test('a penalty does not score the question', () => {
  for (const points of [-100, 0]) {
    const s = locked(room())
    s.round.award = { name: 'Ada', points, penalty: true }
    assert.equal(refuses(s, { a: 'correct' }), null, `penalty of ${points} should stay judgeable`)
  }
})

test('an empty catalog refuses no mode', () => {
  assert.equal(refuses(room(), { a: 'setMode', id: 'anything', options: {} }), null)
})
