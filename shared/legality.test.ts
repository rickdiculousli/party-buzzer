import test from 'node:test'
import assert from 'node:assert/strict'
import { refuses, type Refusal } from './legality.ts'
import type { HostAction, State } from './protocol.ts'

/**
 * A room, built here rather than imported from `server/state.ts`'s `newState`.
 * The point of this module is that legality is expressible over `State` alone,
 * and a test that reached into `server/` to say so would be proving it with the
 * very import the module may not have. `shared/wall.test.ts` builds its room the
 * same way and for the same reason.
 */
function room(): State {
  return {
    grouping: 'solo',
    players: [
      { id: 'a', name: 'Ada', connected: true },
      { id: 'b', name: 'Bo', connected: true },
    ],
    teams: [],
    scores: { a: 0, b: 0 },
    round: { value: 200, phase: 'IDLE', armedAt: 0, order: [], total: 0, lockedOut: [] },
    game: { id: 'trivia', options: {}, moduleState: null },
    items: {},
    effects: [],
    games: [],
    duelRules: [],
    setlists: [],
    packs: [],
    packSizes: {},
    mirrorFragments: false,
    answerWindowSec: 0,
    autoplay: { on: false, nextSec: 4, reboundSec: 3 },
  }
}

/** A round locked with Ada on the buzzer — the only shape a verdict is legal in. */
function locked(s: State): State {
  s.round.phase = 'LOCKED'
  s.round.armedAt = 1000
  s.round.order = [{ playerId: 'a', name: 'Ada', at: 1100, deltaMs: 0 }]
  s.round.total = 1
  return s
}

/**
 * Every `HostAction` kind in a shape that is legal, so the table is checked in
 * both directions. A code that never returns null is a button nobody can press;
 * this is the half of the contract that catches it.
 *
 * The keys are the exhaustiveness check for the *test*: `Record<HostAction['a'], …>`
 * means a new action kind fails to compile here too, and not only in `refuses`.
 */
const LEGAL: Record<HostAction['a'], [State, HostAction]> = {
  arm: [room(), { a: 'arm' }],
  correct: [locked(room()), { a: 'correct' }],
  wrong: [locked(room()), { a: 'wrong', neg: 100 }],
  rebound: [(() => {
    const s = locked(room())
    s.round.held = true
    return s
  })(), { a: 'rebound' }],
  next: [locked(room()), { a: 'next' }],
  resetRound: [locked(room()), { a: 'resetRound' }],
  undo: [locked(room()), { a: 'undo' }],
  setValue: [locked(room()), { a: 'setValue', value: 400 }],
  setAnswerWindow: [locked(room()), { a: 'setAnswerWindow', sec: 10 }],
  setScore: [locked(room()), { a: 'setScore', key: 'a', score: 300 }],
  rename: [locked(room()), { a: 'rename', playerId: 'a', name: 'Ada L' }],
  kick: [locked(room()), { a: 'kick', playerId: 'b' }],
  setGrouping: [room(), { a: 'setGrouping', grouping: 'teams' }],
  addTeam: [locked(room()), { a: 'addTeam', name: 'Red', color: '#f00' }],
  assign: [locked(room()), { a: 'assign', playerId: 'a', teamId: 't' }],
  setMode: [room(), { a: 'setMode', id: 'quizbowl', options: {} }],
  setMirror: [locked(room()), { a: 'setMirror', on: true }],
  setAutoplay: [locked(room()), { a: 'setAutoplay', on: true, nextSec: 5, reboundSec: 4 }],
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
}

test('every action kind has a shape it is legal in', () => {
  for (const [kind, [s, a]] of Object.entries(LEGAL)) {
    assert.equal(refuses(s, a), null, `${kind} should be legal here, got ${refuses(s, a)}`)
  }
})

/** One case per code, each driving a room into the shape that refuses. */
const REFUSED: [Refusal, State, HostAction][] = [
  // Setup is refused mid-question, which is six actions and one code. Every one
  // of them listed: `not-idle` covering only the case somebody remembered is
  // exactly the drift this module exists to stop.
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

  // Nobody on the buzzer. The COLLECTING one is the guard that matters: there
  // IS a provisional leader on the board from 150ms in, and scoring then would
  // strand every buzz still in the air.
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

  // The verdict already landed and the desk goes dead.
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
  // Seated *and* mid-question: both rules bite and the seated one wins, because
  // that is the half the host can do something about.
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
]

test('each code comes back from the shape that earns it', () => {
  for (const [code, s, a] of REFUSED) {
    assert.equal(refuses(s, a), code, `${a.a} in this shape should refuse ${code}`)
  }
})

/**
 * The regression this prevents: arming a LOCKED round is "clear the board and
 * go again", it is what the walkthroughs do, and neither the server nor the
 * host button refuses it today. A table that refused it would silently kill the
 * path the moment `applyHostAction` started asking. The only real restriction —
 * the buzzers already being open — is `useOpen` counting down to `armedAt`, a
 * clock this file may not read, so it stays the surface's.
 */
test('arming a LOCKED round stays legal', () => {
  assert.equal(refuses(locked(room()), { a: 'arm' }), null)
  const armed = room()
  armed.round.phase = 'ARMED'
  assert.equal(refuses(armed, { a: 'arm' }), null, 'and the table has no opinion on an open one either')
})

test('every code in the union is covered by a case', () => {
  const codes: Refusal[] = [
    'not-idle', 'no-leader', 'already-scored', 'nothing-held',
    'no-duel', 'duel-seated', 'unknown-mode', 'no-setlist',
  ]
  const seen = new Set(REFUSED.map(([code]) => code))
  for (const code of codes) assert.ok(seen.has(code), `no case refuses ${code}`)
})

/**
 * A penalty means the question is still live, not scored — the retake has to be
 * judgeable. This is the bug `isPenalty` was introduced for, one value further
 * along: a no-penalty wrong stamps points of zero, and reading the miss off the
 * sign made `>= 0` a payoff and took the desk dead on the rebound it caused.
 */
test('a penalty does not score the question', () => {
  for (const points of [-100, 0]) {
    const s = locked(room())
    s.round.award = { name: 'Ada', points, penalty: true }
    assert.equal(refuses(s, { a: 'correct' }), null, `penalty of ${points} should stay judgeable`)
  }
})

/**
 * The catalog rides in `State` and starts empty — `newState()` ships `games: []`
 * and the hub fills it at startup. An empty catalog is no opinion, not a claim
 * that nothing exists, or the table would be stricter than the server it speaks
 * for and every mid-boot `setMode` would be refused.
 */
test('an empty catalog refuses no mode', () => {
  assert.equal(refuses(room(), { a: 'setMode', id: 'anything', options: {} }), null)
})
