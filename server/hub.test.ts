import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import { Hub, type Conn } from './hub.ts'
import { newState } from './state.ts'
import { MinigameRuntime } from './minigames/runtime.ts'
import { ARM_DELAY_MS, COLLECT_MS, type Role, type ServerMsg, type State } from '../shared/protocol.ts'
import { momentOf, wallOf, type Local } from '../shared/wall.ts'
import { arrivalPresentation, introductionFor } from '../shared/arrival.ts'

function rig() {
  const state = newState()
  const hub = new Hub(state)
  const sent: ServerMsg[][] = []
  const conn = (role: Role, playerId?: string): Conn => {
    const box: ServerMsg[] = []
    sent.push(box)
    const c: Conn = {
      id: Math.random().toString(36).slice(2),
      role,
      playerId,
      send: (m) => box.push(m),
    }
    hub.add(c)
    return c
  }
  const lastState = (c: number): State => sent[c].findLast((m) => m.t === 'state')!.state
  return { state, hub, conn, lastState }
}

function joinAs(hub: Hub, conn: Conn, name: string): void {
  hub.handle(conn, { t: 'hello', role: 'player', name })
}

test('host acts append fragments and reveal the answer; player acts of that kind are dropped', () => {
  const { hub, conn, lastState } = rig()
  const host = conn('host')
  const phone = conn('player')
  hub.handle(host, { t: 'act', act: 'fragment', data: 'First fragment.' })
  hub.handle(phone, { t: 'act', act: 'fragment', data: 'forged' })
  hub.handle(host, { t: 'act', act: 'revealAnswer', data: 'The answer' })
  const s = lastState(0)
  assert.deepEqual(s.round.fragments, ['First fragment.'])
  assert.equal(s.round.answer, 'The answer')
})

test('player views strip fragments, answer, and module state', () => {
  const { state, hub, conn } = rig()
  state.game.moduleState = { powerEndsAt: 123 }
  state.round.fragments = ['Secret text']
  state.round.answer = 'Secret answer'
  const phone = conn('player')
  joinAs(hub, phone, 'Ada')
  const view = hub.viewFor(phone)
  assert.equal(view.round.fragments, undefined)
  assert.equal(view.round.answer, undefined)
  assert.equal(view.game.moduleState, undefined)
  const hostView = hub.viewFor(conn('host'))
  assert.deepEqual(hostView.round.fragments, ['Secret text'])
  assert.deepEqual(hostView.game.moduleState, { powerEndsAt: 123 })
})

test('a frozen player\'s buzz never enters the window', () => {
  const { state, hub, conn } = rig()
  const phone = conn('player')
  joinAs(hub, phone, 'Ada')
  const playerId = phone.playerId!
  state.round.phase = 'ARMED'
  state.round.armedAt = Date.now() - 10
  state.effects = [{ kind: 'frozen', playerId, attemptId: state.round.attemptId }]
  hub.handle(phone, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'ARMED', 'the window never opened')
  assert.equal(state.round.total, 0)
})

test('useItem rides the act channel and broadcast follows', () => {
  const { state, hub, conn } = rig()
  const ada = conn('player')
  const bo = conn('player')
  joinAs(hub, ada, 'Ada')
  joinAs(hub, bo, 'Bo')
  state.items[ada.playerId!] = ['freeze']
  hub.handle(ada, { t: 'act', act: 'useItem', data: { itemId: 'freeze', targetId: bo.playerId } })
  assert.deepEqual(state.effects, [{ kind: 'frozen', playerId: bo.playerId }])
})

test('players see mirrored fragments only when the mirror is on', () => {
  const { state, hub, conn } = rig()
  const phone = conn('player')
  hub.handle(phone, { t: 'hello', role: 'player', name: 'Ada' })
  state.round.fragments = ['First fragment.']
  state.round.answer = 'gold'

  const off = hub.viewFor(phone)
  assert.equal(off.round.fragments, undefined, 'off: the phone sees nothing')
  assert.equal(off.round.answer, undefined)

  state.mirrorFragments = true
  const on = hub.viewFor(phone)
  assert.deepEqual(on.round.fragments, ['First fragment.'], 'on: the phone mirrors the board')
  assert.equal(on.round.answer, 'gold')
})

test('the unspoken remainder never reaches a phone, mirror or no mirror', () => {
  const { state, hub, conn } = rig()
  const phone = conn('player')
  hub.handle(phone, { t: 'hello', role: 'player', name: 'Ada' })
  state.round.fragments = ['First fragment.']
  state.round.whole = 'First fragment. And the half nobody has heard yet.'

  assert.equal(hub.viewFor(phone).round.whole, undefined, 'off')
  state.mirrorFragments = true
  assert.equal(hub.viewFor(phone).round.whole, undefined, 'on — the mirror is only what was said')
  assert.equal(
    hub.viewFor(conn('board')).round.whole,
    state.round.whole,
    'the board gets all of it, to lay out',
  )
})

test('a question image reaches a phone only with the mirror on', () => {
  const { state, hub, conn } = rig()
  const phone = conn('player')
  hub.handle(phone, { t: 'hello', role: 'player', name: 'Ada' })
  state.round.image = '/pack-media/tower.jpg'

  assert.equal(hub.viewFor(phone).round.image, undefined, 'off')
  assert.equal(hub.viewFor(conn('board')).round.image, state.round.image, 'the board always')
  state.mirrorFragments = true
  assert.equal(hub.viewFor(phone).round.image, state.round.image, 'on')
})

test('the mirror never widens the buzz-order redaction', () => {
  const { state, hub, conn } = rig()
  const a = conn('player')
  const b = conn('player')
  hub.handle(a, { t: 'hello', role: 'player', name: 'Ada' })
  hub.handle(b, { t: 'hello', role: 'player', name: 'Bo' })
  state.mirrorFragments = true
  state.round.order = [
    { playerId: a.playerId!, name: 'Ada', at: 1, deltaMs: 0 },
    { playerId: b.playerId!, name: 'Bo', at: 2, deltaMs: 1 },
  ]
  assert.equal(hub.viewFor(a).round.order.length, 1, 'still only your own buzz')
})

test('a phone knows whether its buzz leads even when displayed margins tie', () => {
  const { state, hub, conn } = rig()
  const a = conn('player')
  const b = conn('player')
  joinAs(hub, a, 'Ada')
  joinAs(hub, b, 'Bo')
  state.round.order = [
    { playerId: a.playerId!, name: 'Ada', at: 1, deltaMs: 0 },
    { playerId: b.playerId!, name: 'Bo', at: 1.4, deltaMs: 0 },
  ]
  const first = hub.viewFor(a).round.order
  const second = hub.viewFor(b).round.order
  assert.equal(first.length, 1)
  assert.equal(second.length, 1)
  assert.equal(first[0].leader, true)
  assert.equal(second[0].leader, false)
  assert.equal(state.round.order[0].leader, undefined, 'projection does not change live order')
})

test('reading progress is host/board only, never sent to a player view', () => {
  const { state, hub, conn } = rig()
  state.readingActive = true
  state.reading = {
    pack: 'science.txt',
    qIndex: 1,
    qTotal: 5,
    fragIndex: 2,
    fragTotal: 3,
    paused: false,
  }
  const phone = conn('player')
  joinAs(hub, phone, 'Ada')
  assert.equal(hub.viewFor(phone).reading, undefined)
  assert.equal(hub.viewFor(phone).readingActive, true)
  assert.deepEqual(hub.viewFor(conn('host')).reading, state.reading)
})

test('board and phones agree throughout an automated rebound without exposing pack progress', () => {
  const { hub, state, conn } = rig()
  const host = conn('host')
  const board = conn('board')
  const phone = conn('player')
  joinAs(hub, phone, 'Ada')
  hub.handle(host, { t: 'act', act: 'reading', data: {
    active: true,
    progress: { pack: 'private.txt', qIndex: 0, qTotal: 1, fragIndex: 0, fragTotal: 1, paused: false },
  } })
  state.autoplay.on = true
  hub.handle(host, { t: 'host', action: { a: 'arm' } })
  state.round.phase = 'LOCKED'
  state.round.order = [{ playerId: phone.playerId!, name: 'Ada', at: state.round.armedAt, deltaMs: 0 }]
  const same = () => {
    for (const open of [false, true]) for (const settled of [false, true]) for (const retired of [false, true]) {
      const local = { open, settled, retired }
      assert.equal(momentOf(hub.viewFor(phone), local), momentOf(hub.viewFor(board), local))
    }
    assert.equal(hub.viewFor(phone).reading, undefined)
  }
  hub.handle(host, { t: 'host', action: { a: 'wrong', neg: 0 } })
  assert.equal(state.round.held, true)
  same()
  hub.handle(host, { t: 'host', action: { a: 'rebound' } })
  same()
  assert.equal(momentOf(hub.viewFor(phone), { open: true, settled: true, retired: false }), 'buzz:open')
  hub.handle(host, { t: 'act', act: 'reading', data: undefined })
  same()
  assert.equal(hub.viewFor(phone).readingActive, false)
})

test('the reading act is host-scoped and lands in state', () => {
  const { hub, conn, lastState } = rig()
  const host = conn('host')
  const phone = conn('player')
  const reading = {
    pack: 'one.txt', qIndex: 0, qTotal: 3, fragIndex: 1, fragTotal: 2, paused: false,
  }
  hub.handle(phone, { t: 'act', act: 'reading', data: { ...reading, pack: 'forged.txt' } })
  assert.equal(hub.state.reading, undefined, 'a phone cannot fake reading progress')
  hub.handle(host, { t: 'act', act: 'reading', data: { progress: reading, active: true } })
  assert.equal(lastState(0).reading?.pack, 'one.txt')
})

test('unknown acts are dropped and logged once', () => {
  const { hub, conn } = rig()
  const host = conn('host')
  const warnings: string[] = []
  const orig = console.warn
  console.warn = (s: string) => warnings.push(s)
  try {
    hub.handle(host, { t: 'act', act: 'bogus' })
    hub.handle(host, { t: 'act', act: 'bogus' })
  } finally {
    console.warn = orig
  }
  assert.equal(warnings.length, 1)
})

test('a selectPack that fails is logged, not thrown — the process must survive it', async () => {
  const state = newState()
  const hub = new Hub(state, {
    reader: {
      select: () => Promise.reject(new Error('no such pack')),
      start: () => {},
      carryOn: () => {},
      announce: () => {},
      pause: () => {},
      resume: () => {},
      stop: () => {},
      rewind: () => {},
      closeChoice: () => {},
    },
  })
  const host: Conn = { id: 'h', role: 'host', send: () => {} }
  hub.add(host)
  const warnings: string[] = []
  const orig = console.warn
  console.warn = (s: string) => warnings.push(s)
  try {
    hub.handle(host, { t: 'act', act: 'selectPack', data: 'nope.txt' })
    // Let the rejected promise's .catch handler run.
    await new Promise((r) => setTimeout(r, 0))
  } finally {
    console.warn = orig
  }
  assert.ok(warnings.some((w) => w.includes('selectPack failed')))
  // The hub is still usable — the rejection did not take the process down.
  hub.handle(host, { t: 'act', act: 'fragment', data: 'still alive' })
  assert.deepEqual(hub.state.round.fragments, ['still alive'])
})

test('a duel narrows the window to the seated pair', () => {
  const { state, hub, conn } = rig()
  const a = conn('player')
  const b = conn('player')
  const c = conn('player')
  joinAs(hub, a, 'A')
  joinAs(hub, b, 'B')
  joinAs(hub, c, 'C')
  state.round.buzzable = [a.playerId!, b.playerId!]
  state.round.phase = 'ARMED'
  state.round.armedAt = Date.now() - 10
  hub.handle(c, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'ARMED', 'a spectator never opens the window')
  hub.handle(a, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'COLLECTING', 'a seated player buzzes through')
})

test('duel acts ride the act channel from players only', () => {
  const { state, hub, conn } = rig()
  const host = conn('host')
  const phone = conn('player')
  joinAs(hub, phone, 'Ada')
  state.duel = { rule: 'volunteer-random', pool: [], missed: [] }
  hub.handle(host, { t: 'act', act: 'duelVolunteer' })
  assert.equal(state.duel.pool.length, 0, 'no playerId, no entry')
  hub.handle(phone, { t: 'act', act: 'duelVolunteer' })
  assert.equal(state.duel.pool.length, 1)
  assert.equal(state.duel.pool[0].playerId, phone.playerId)
})

test('the duel pool is visible in player views', () => {
  const { state, hub, conn } = rig()
  const phone = conn('player')
  joinAs(hub, phone, 'Ada')
  state.duel = {
    rule: 'vote',
    pool: [{ playerId: 'b', votes: ['a'], in: false }],
    missed: [],
  }
  assert.equal(hub.viewFor(phone).duel?.pool.length, 1, 'the room sees the pool')
  assert.equal(hub.viewFor(conn('host')).duel?.pool.length, 1)
})

test('the wall and the phones never disagree about the moment', async () => {
  // The whole point of putting `Moment` in shared/: `viewFor` redacts `order`,
  // `whole`, `fragments` and `answer`, so a moment derived from any of them
  // would differ per phone. Stepping a real question through the hub is the
  // check that none of them crept in.
  const { state, hub, conn, lastState } = rig()
  const host = conn('host')
  const ada = conn('player')
  const watcher = conn('player')
  joinAs(hub, ada, 'Ada')
  joinAs(hub, watcher, 'Cy')

  const l: Local = { open: false, settled: true, retired: false }
  const agree = (why: string) => {
    // lastState(1) is Ada, who buzzes; lastState(2) is Cy, who never does —
    // the redaction gap is widest between those two.
    assert.equal(momentOf(hub.state, l), momentOf(lastState(1), l), `${why}: Ada`)
    assert.equal(momentOf(hub.state, l), momentOf(lastState(2), l), `${why}: Cy`)
  }

  agree('idle')
  hub.handle(host, { t: 'act', act: 'fragment', data: 'A clue.' })
  agree('a fragment only the wall can read')

  hub.handle(host, { t: 'host', action: { a: 'arm' } })
  agree('armed')
  await new Promise((r) => setTimeout(r, ARM_DELAY_MS + 5))
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  agree('collecting, before the reveal')
  await new Promise((r) => setTimeout(r, COLLECT_MS + 60))
  agree('locked, with an order only the wall sees whole')

  hub.handle(host, { t: 'host', action: { a: 'wrong', neg: 100 } })
  agree('the penalty and its rebound')
  // Refused: nobody has buzzed the rebound, so this changes nothing — and a
  // moment that stayed in step through a no-op is the one that would have
  // drifted if it read `order`.
  hub.handle(host, { t: 'host', action: { a: 'correct' } })
  agree('a verdict refused for want of a leader')
  assert.equal(state.round.phase, 'ARMED', 'the rebound is still open')
})

test('lobby picks broadcast state and touches reach only the named audience', () => {
  const { state, hub, conn, lastState } = rig()
  const runtime = new MinigameRuntime(state, {
    onState: (cause) => hub.minigameChanged(cause), onFrame: () => {}, onAck: () => {}, onComplete: () => {},
  })
  hub.setMinigameRuntime(runtime)
  const board = conn('board')
  const ada = conn('player')
  const bo = conn('player')
  joinAs(hub, ada, 'Ada')
  joinAs(hub, bo, 'Bo')
  state.minigame = { id: 'bow', matchId: 'm', phase: 'ready', options: { durationSec: 40, seed: 1 }, participants: [], lobby: { teams: {}, volunteers: [], ready: [] } }
  hub.handle(ada, { t: 'minigameLobby', change: { do: 'join', team: 'sun' } })
  assert.equal(lastState(1).minigame?.lobby?.teams[ada.playerId!], 'sun')

  const sentTo = (c: typeof ada) => {
    const msgs: unknown[] = []
    c.send = (m) => { msgs.push(m) }
    return msgs
  }
  const boardMsgs = sentTo(board)
  const adaMsgs = sentTo(ada)
  const boMsgs = sentTo(bo)
  runtime.touch = () => ({ players: [ada.playerId!], board: true })
  hub.handle(ada, { t: 'minigameTouch', matchId: 'm', target: 'row:sun:0', x: 0.1, y: 0.2 })
  const expected = { t: 'minigameTouch', touch: { playerId: ada.playerId, name: 'Ada', target: 'row:sun:0', x: 0.1, y: 0.2 } }
  assert.deepEqual(boardMsgs, [expected])
  assert.deepEqual(adaMsgs, [expected])
  assert.deepEqual(boMsgs, [])
})

function pickRig() {
  const state = newState()
  const hub = new Hub(state, { collectMs: 30, revealMs: 10 })
  const host: Conn = { id: 'h', role: 'host', send() {} }
  const phone = (id: string): Conn => {
    const conn: Conn = { id, playerId: id, role: 'player', send() {} }
    hub.handle(conn, { t: 'hello', role: 'player', name: id, playerId: id })
    return conn
  }
  const ada = phone('ada')
  const bo = phone('bo')
  hub.dispatch({ a: 'arm', kind: 'choice' })
  state.round.armedAt = Date.now() - 10
  return { state, hub, host, ada, bo }
}

test('a pick is taken once, only while picking is open, and a buzz is refused', () => {
  const { state, hub, host, ada, bo } = pickRig()
  hub.handle(ada, { t: 'act', act: 'pick', data: 0 })
  assert.equal(state.round.picks, undefined, 'no pick before the choices are up')
  hub.handle(host, { t: 'act', act: 'choices', data: ['Mars', 'Saturn'] })
  hub.handle(ada, { t: 'act', act: 'pick', data: 1 })
  hub.handle(ada, { t: 'act', act: 'pick', data: 0 })
  hub.handle(bo, { t: 'act', act: 'pick', data: 7 })
  assert.deepEqual(state.round.picks, { ada: 1 }, 'locked in; out of range ignored')
  hub.handle(bo, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'ARMED', 'nobody buzzes a choice question')
  hub.handle(host, { t: 'act', act: 'closesAt', data: Date.now() - 1 })
  hub.handle(bo, { t: 'act', act: 'pick', data: 0 })
  assert.deepEqual(state.round.picks, { ada: 1 }, 'late pick ignored')
})

test('a phone sees only its own pick, and the text of a choice question without the mirror', () => {
  const { state, hub, host, ada, bo } = pickRig()
  hub.handle(host, { t: 'act', act: 'fragment', data: 'Which planet?' })
  hub.handle(host, { t: 'act', act: 'choices', data: ['Mars', 'Saturn'] })
  hub.handle(ada, { t: 'act', act: 'pick', data: 1 })
  hub.handle(bo, { t: 'act', act: 'pick', data: 0 })
  assert.equal(state.mirrorFragments, false)
  const view = hub.viewFor(ada)
  assert.deepEqual(view.round.picks, { ada: 1 })
  assert.deepEqual(view.round.fragments, ['Which planet?'])
  assert.deepEqual(view.round.choices, ['Mars', 'Saturn'])
  assert.deepEqual(hub.viewFor(host).round.picks, { ada: 1, bo: 0 })
})

test('a phone may not publish choices', () => {
  const { state, hub, ada } = pickRig()
  hub.handle(ada, { t: 'act', act: 'choices', data: ['x', 'y'] })
  assert.equal(state.round.choices, undefined)
})

function guessRig() {
  const { state, hub, host, ada, bo } = pickRig()
  hub.dispatch({ a: 'arm', kind: 'closest' })
  state.round.armedAt = Date.now() - 10
  return { state, hub, host, ada, bo }
}

test('a guess is a number, taken once, only while guessing is open, and a buzz is refused', () => {
  const { state, hub, host, ada, bo } = guessRig()
  hub.handle(ada, { t: 'act', act: 'guess', data: 1700 })
  assert.equal(state.round.guesses, undefined, 'no guess before guessing opens')
  hub.handle(host, { t: 'act', act: 'guessing', data: { unit: 'steps', closesAt: Date.now() + 60_000 } })
  for (const junk of ['1700', null, Number.NaN, Infinity, { n: 1 }]) hub.handle(bo, { t: 'act', act: 'guess', data: junk })
  assert.equal(state.round.guesses, undefined, 'a guess that is not a number is refused')
  hub.handle(ada, { t: 'act', act: 'guess', data: 1700 })
  hub.handle(ada, { t: 'act', act: 'guess', data: 1665 })
  assert.deepEqual(state.round.guesses, { ada: 1700 }, 'locked in')
  hub.handle(bo, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'ARMED', 'nobody buzzes a closest question')
  hub.handle(host, { t: 'act', act: 'guessing', data: { closesAt: Date.now() - 1 } })
  hub.handle(bo, { t: 'act', act: 'guess', data: 1200 })
  assert.deepEqual(state.round.guesses, { ada: 1700 }, 'late guess ignored')
})

test('a phone sees only its own guess and its own pay', () => {
  const { state, hub, host, ada, bo } = guessRig()
  hub.handle(host, { t: 'act', act: 'guessing', data: { closesAt: Date.now() + 60_000 } })
  hub.handle(ada, { t: 'act', act: 'guess', data: 1700 })
  hub.handle(bo, { t: 'act', act: 'guess', data: 1200 })
  assert.deepEqual(hub.viewFor(ada).round.guesses, { ada: 1700 })
  assert.deepEqual(hub.viewFor(host).round.guesses, { ada: 1700, bo: 1200 })
  state.round.value = 200
  hub.dispatch({ a: 'settleClosest', truth: 1665 })
  assert.deepEqual(hub.viewFor(ada).round.paid, { ada: 200 })
  assert.equal(hub.viewFor(bo).round.paid, undefined)
  assert.deepEqual(hub.viewFor(bo).round.guesses, { bo: 1200 })
  assert.equal(hub.viewFor(bo).round.truth, 1665, 'the answer is public once it is up')
  assert.equal(state.scores.ada, 200)
})

test('a phone may not open guessing', () => {
  const { state, hub, ada } = guessRig()
  hub.handle(ada, { t: 'act', act: 'guessing', data: { closesAt: Date.now() + 60_000 } })
  assert.equal(state.round.guessing, undefined)
})

test('closing the minigame a setlist block names moves to the next block in one undo step', () => {
  const { state, hub, conn } = rig()
  hub.setMinigameRuntime(new MinigameRuntime(state, {
    onState: () => {}, onFrame: () => {}, onAck: () => {}, onComplete: () => {},
  }))
  const host = conn('host')
  const act = (action: import('../shared/protocol.ts').HostAction) => hub.handle(host, { t: 'host', action })
  act({ a: 'setSetlist', blocks: [{ game: 'bow', options: {}, count: 1 }, { game: 'trivia', options: {}, count: 3 }] })
  // The first block's introduction holds the minigame until the host continues.
  act({ a: 'closeArrival', arrivalId: state.arrival!.id })
  act({ a: 'prepareMinigame', id: 'bow', options: {} })
  act({ a: 'closeMinigame' })
  assert.equal(state.minigame?.id, undefined)
  assert.equal(state.setlist!.at, 1)
  act({ a: 'undo' })
  assert.equal(state.minigame?.id, 'bow')
  assert.equal(state.setlist!.at, 0)
})

test('no view carries a minigame checkpoint beyond its label', () => {
  const { state, hub, conn } = rig()
  state.minigame = {
    id: 'poker', matchId: 'm', phase: 'ready', options: { durationSec: 40, seed: 1 }, participants: [],
    checkpoint: { version: 3, label: 'hand 3', data: { deckSeed: 99 } },
  }
  for (const role of ['player', 'board', 'host'] as const) {
    assert.deepEqual(hub.viewFor(conn(role, role === 'player' ? 'a' : undefined)).minigame?.checkpoint, { version: 3, label: 'hand 3' })
  }
  assert.deepEqual(state.minigame.checkpoint?.data, { deckSeed: 99 })
})


test('hello sends a current private or board frame even when poker is quiet', () => {
  const state = newState()
  state.players = [{ id: 'ada', name: 'Ada', connected: true }, { id: 'bo', name: 'Bo', connected: true }]
  const hub = new Hub(state)
  const runtime = new MinigameRuntime(state, { onState() {}, onFrame() {}, onAck() {}, onComplete() {} })
  hub.setMinigameRuntime(runtime)
  runtime.host({ a: 'prepareMinigame', id: 'poker', options: {} })
  runtime.host({ a: 'startMinigame' })
  const messages: ServerMsg[] = []
  const conn: Conn = { id: 'late', role: 'board', send: (msg) => messages.push(msg) }
  hub.add(conn)
  hub.handle(conn, { t: 'hello', role: 'board' })
  const board = messages.findLast((msg) => msg.t === 'minigameFrame')
  assert.ok(board?.t === 'minigameFrame' && board.frame.role === 'board')
  assert.equal('hole' in board.frame, false)
  hub.handle(conn, { t: 'hello', role: 'player', playerId: 'ada' })
  const phone = messages.findLast((msg) => msg.t === 'minigameFrame')
  assert.ok(phone?.t === 'minigameFrame' && phone.frame.id === 'poker' && phone.frame.role === 'player' && phone.frame.hole?.length === 2)
})

/** A room with Ada and Bo joined and a lobby open, plus a spy on `onChange`. */
function lobbyRig() {
  const state = newState()
  let changes = 0
  const hub = new Hub(state, { onChange: () => changes++ })
  const boxes: ServerMsg[][] = []
  const conn = (role: Role): Conn => {
    const box: ServerMsg[] = []
    boxes.push(box)
    const c: Conn = { id: Math.random().toString(36).slice(2), role, send: (m) => box.push(m) }
    hub.add(c)
    return c
  }
  const ada = conn('player')
  const bo = conn('player')
  joinAs(hub, ada, 'Ada')
  joinAs(hub, bo, 'Bo')
  const host = conn('host')
  const before = changes
  assert.equal(hub.dispatch({ a: 'openLobby' }).status, 'applied')
  const lobby = state.arrival!
  assert.equal(lobby.kind, 'lobby')
  const receipts = (i: number) => boxes[i].flatMap((m) => (m.t === 'practiceBuzz' ? [m.receipt] : []))
  return { state, hub, ada, bo, host, lobbyId: lobby.id, receipts, changes: () => changes - before, boxes }
}

test('practice marks tested once, relays every press, and never touches gameplay or history', () => {
  const { state, hub, ada, lobbyId, receipts, changes } = lobbyRig()
  state.scores[ada.playerId!] = 300
  const round = structuredClone(state.round)
  const scores = structuredClone(state.scores)

  hub.handle(ada, { t: 'practiceBuzz', lobbyId })
  hub.handle(ada, { t: 'practiceBuzz', lobbyId })
  hub.handle(ada, { t: 'practiceBuzz', lobbyId })

  assert.deepEqual(state.arrival, { kind: 'lobby', id: lobbyId, testedPlayerIds: [ada.playerId] })
  assert.deepEqual(receipts(1).map((r) => r.seq), [1, 2, 3], 'every connection sees each press')
  assert.ok(receipts(0).every((r) => r.playerId === ada.playerId && r.lobbyId === lobbyId))
  assert.deepEqual(state.round, round)
  assert.deepEqual(state.scores, scores)
  assert.equal(changes(), 0, 'opening and practising never notify persistence, reader or judge')
  assert.equal(hub.dispatch({ a: 'undo' }).status, 'unchanged', 'nothing entered history')
  assert.equal(state.arrival?.id, lobbyId, 'empty undo keeps the lobby')

  assert.equal(hub.dispatch({ a: 'closeArrival', arrivalId: lobbyId }).status, 'applied')
  assert.equal(state.arrival, undefined)
  assert.equal(changes(), 0, 'closing is runtime too')
})

test('a stale practice press or stale close has no effect on the current arrival', () => {
  const { state, hub, ada, host, lobbyId: oldId, receipts } = lobbyRig()
  hub.dispatch({ a: 'closeArrival', arrivalId: oldId })
  hub.dispatch({ a: 'openLobby' })
  const current = structuredClone(state.arrival)

  hub.handle(ada, { t: 'practiceBuzz', lobbyId: oldId })
  hub.handle(host, { t: 'practiceBuzz', lobbyId: current!.id })
  assert.deepEqual(receipts(0), [], 'old lobby and wrong role emit nothing')
  assert.deepEqual(state.arrival, current)

  assert.deepEqual(hub.dispatch({ a: 'closeArrival', arrivalId: oldId }), { status: 'refused', reason: 'arrival-changed' })
  assert.deepEqual(state.arrival, current)

  // The same for an introduction: an old Continue cannot dismiss a newer one.
  hub.dispatch({ a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 2 }] })
  const intro = structuredClone(state.arrival)
  assert.equal(intro?.kind, 'introduction')
  assert.deepEqual(hub.dispatch({ a: 'closeArrival', arrivalId: current!.id }), { status: 'refused', reason: 'arrival-changed' })
  assert.deepEqual(state.arrival, intro)
  assert.equal(hub.dispatch({ a: 'closeArrival', arrivalId: intro!.id }).status, 'applied')
  assert.equal(state.arrival, undefined)
  assert.equal(state.round.phase, 'IDLE', 'Continue does not arm')
})

test('a fresh setlist over a retained verdict or choice reveal shows only the introduction', () => {
  for (const leftover of ['verdict', 'choice'] as const) {
    const { state, hub, ada } = lobbyRig()
    Object.assign(state.round, {
      questionId: 'old', armedAt: 1, phase: 'IDLE', answer: 'Old answer', fragments: ['Old clue'], whole: 'Old clue',
      spoken: { name: 'Ada', transcript: 'old guess', hit: true },
      ...(leftover === 'verdict'
        ? { award: { name: 'Ada', points: 100 } }
        : { kind: 'choice', choices: ['Old A', 'Old B'], correct: 0, picks: { [ada.playerId!]: 0 } }),
    })
    hub.dispatch({ a: 'setSetlist', blocks: [{ game: 'quizbowl', options: {}, count: 2 }] })

    const local: Local = { open: false, settled: true, retired: false }
    const board = hub.viewFor({ id: 'b', role: 'board', send() {} })
    const phone = hub.viewFor(ada)
    assert.equal(momentOf(board, local), 'arrival:introduction', leftover)
    assert.equal(momentOf(phone, local), 'arrival:introduction', leftover)

    const wall = wallOf(board, local)
    assert.deepEqual(wall.arrival, { kind: 'introduction', ...introductionFor('quizbowl'), detail: '2 questions', next: false })
    for (const lane of ['hero', 'clue', 'nominations', 'faceoff', 'call', 'finale', 'next',
      'unanswered', 'transcript', 'award', 'value', 'choices'] as const) {
      assert.equal(wall[lane], null, `${leftover}: ${lane}`)
    }
    assert.equal(wall.timeline, false)
    assert.deepEqual(arrivalPresentation(phone), wall.arrival, 'the phone gets the same copy and nothing else')
    assert.ok(!JSON.stringify(wall).includes('Old'), `${leftover}: no old content on the wall`)
  }
})

test('Next on a pending introduction over a played retained round keeps the first question', () => {
  const { state, hub } = lobbyRig()
  Object.assign(state.round, { questionId: 'old', armedAt: 1, phase: 'IDLE' })
  hub.dispatch({ a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 2 }] })
  assert.equal(state.arrival?.kind, 'introduction')
  hub.dispatch({ a: 'next' })
  assert.equal(state.arrival, undefined)
  assert.deepEqual([state.setlist?.at, state.setlist?.done], [0, 0], 'block 0 has not spent a question')
})

test('a fresh setlist forgets the old round: Continue shows no old award, then Next spends nothing', () => {
  const { state, hub } = lobbyRig()
  Object.assign(state.round, { questionId: 'old', armedAt: 1, phase: 'IDLE', award: { name: 'Ada', points: 100 } })
  hub.dispatch({ a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 2 }] })
  hub.dispatch({ a: 'closeArrival', arrivalId: state.arrival!.id })
  assert.equal(state.round.award, undefined)
  hub.dispatch({ a: 'next' })
  assert.deepEqual([state.setlist?.at, state.setlist?.done], [0, 0], 'block 0 has not spent a question')
})

test('a kept-cursor setlist edit keeps the pending introduction; an identical one is unchanged', () => {
  const { state, hub } = lobbyRig()
  hub.dispatch({ a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 2 }, { game: 'trivia', options: {}, count: 1 }] })
  const id = state.arrival?.id
  assert.ok(id)
  assert.equal(hub.dispatch({ a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 2 }, { game: 'trivia', options: {}, count: 4 }] }).status, 'applied')
  assert.equal(state.arrival?.id, id)
  assert.equal(hub.dispatch({ a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 2 }, { game: 'trivia', options: {}, count: 4 }] }).status, 'unchanged')
})

test('clearSetlist clears the night\'s pending timers', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    const { state, hub } = rig()
    const held = () => (hub as unknown as { night: Map<string, unknown> }).night.size
    hub.dispatch({ a: 'setAutoplay', on: true, nextSec: 5, buzzSec: 10, reboundSec: 4, introSec: 12 })
    hub.dispatch({ a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 1 }, { game: 'trivia', options: {}, count: 1 }] })
    hub.dispatch({ a: 'setlistJump', at: 1 })
    assert.equal(held(), 1, 'the introduction is on a clock')
    assert.equal(hub.dispatch({ a: 'clearSetlist' }).status, 'applied')
    assert.equal(state.arrival, undefined)
    assert.equal(held(), 0)
    // A refusal or a no-op touches nothing: a second clear changes no timer.
    hub.dispatch({ a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 1 }, { game: 'trivia', options: {}, count: 1 }] })
    hub.dispatch({ a: 'setlistJump', at: 1 })
    assert.equal(hub.dispatch({ a: 'closeArrival', arrivalId: 'stale' }).status, 'refused')
    assert.equal(held(), 1)
  } finally {
    mock.timers.reset()
  }
})

test('clearSetlist clears a pending ready or results timer', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    const { state, hub } = rig()
    state.players = [{ id: 'ada', name: 'Ada', connected: true }]
    hub.setMinigameRuntime(new MinigameRuntime(state, {
      onState: (cause) => hub.minigameChanged(cause), onFrame() {}, onAck() {},
      onComplete: (matchId, results) => hub.completeMinigame(matchId, results),
    }))
    const held = () => (hub as unknown as { night: Map<string, unknown> }).night
    hub.dispatch({ a: 'setAutoplay', on: true, nextSec: 5, buzzSec: 10, reboundSec: 4, introSec: 1 })
    hub.dispatch({ a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 1 }, { game: 'bow', options: { durationSec: 5, seed: 1 }, count: 1 }] })
    hub.dispatch({ a: 'setlistJump', at: 1 })
    mock.timers.tick(1_000)
    assert.equal(state.minigame?.phase, 'ready')
    assert.ok(held().has('ready'), 'the ready fallback is on a clock')
    // An open match refuses clearSetlist outright, so its timers can only end by closing it.
    assert.equal(hub.dispatch({ a: 'clearSetlist' }).status, 'refused', 'an open match holds the setlist')
    assert.ok(held().has('ready'), 'a refusal leaves the fallback alone')
    assert.equal(hub.dispatch({ a: 'closeMinigame' }).status, 'applied')
    assert.ok(!held().has('ready'), 'closing the match ends its fallback')
    assert.equal(hub.dispatch({ a: 'clearSetlist' }).status, 'applied')
    assert.equal(held().size, 0)
    mock.timers.tick(120_000)
    assert.equal(state.minigame, undefined, 'nothing fires after the fallback has elapsed')
    assert.equal(state.arrival, undefined)
    assert.equal(state.setlist, undefined)
  } finally {
    mock.timers.reset()
  }
})

test('the night: a verdict appends a fact, undo retracts it, a refusal appends nothing, a phone never sees it', () => {
  const { state, hub, conn } = rig()
  state.players = [{ id: 'a', name: 'Ada', connected: true }, { id: 'b', name: 'Bo', connected: true }]
  state.round = {
    ...state.round,
    questionId: 'q1',
    phase: 'LOCKED',
    armedAt: 1_000,
    order: [{ playerId: 'b', name: 'Bo', at: 1_240, deltaMs: 0 }, { playerId: 'a', name: 'Ada', at: 1_300, deltaMs: 60 }],
    total: 2,
  }
  assert.equal(hub.dispatch({ a: 'correct' }).status, 'applied')
  const verdict = state.night!.facts.find((f) => f.kind === 'verdict')
  assert.ok(verdict && verdict.kind === 'verdict')
  assert.deepEqual([verdict.name, verdict.hit, verdict.reactionMs, verdict.marginMs], ['Bo', true, 240, 60])

  const count = state.night!.facts.length
  assert.equal(hub.dispatch({ a: 'correct' }).status, 'refused', 'nobody left to score')
  assert.equal(state.night!.facts.length, count, 'a refusal appends nothing')

  const phone = conn('player')
  joinAs(hub, phone, 'Cy')
  assert.equal(hub.viewFor(phone).night, undefined)
  assert.ok(hub.viewFor(conn('host')).night)

  assert.equal(hub.dispatch({ a: 'undo' }).status, 'applied')
  assert.deepEqual(state.night!.facts, [], 'undo takes the verdict and its standings back')
})
