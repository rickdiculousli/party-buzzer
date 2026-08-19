import test from 'node:test'
import assert from 'node:assert/strict'
import { Hub, type Conn } from './hub.ts'
import { newState } from './state.ts'
import { ARM_LEAD_MS, COLLECT_MS, type Role, type ServerMsg, type State } from '../shared/protocol.ts'
import { momentOf, type Local } from '../shared/wall.ts'

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
  const lastState = (c: number): State => (sent[c].at(-1) as { state: State }).state
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
  state.effects = [{ kind: 'frozen', playerId, roundArmedAt: state.round.armedAt }]
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

test('reading progress is host/board only, never sent to a player view', () => {
  const { state, hub, conn } = rig()
  state.reading = {
    pack: 'science.txt',
    qIndex: 1,
    qTotal: 5,
    fragIndex: 2,
    fragTotal: 3,
    paused: false,
    running: true,
  }
  const phone = conn('player')
  joinAs(hub, phone, 'Ada')
  assert.equal(hub.viewFor(phone).reading, undefined)
  assert.deepEqual(hub.viewFor(conn('host')).reading, state.reading)
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
  hub.handle(host, { t: 'act', act: 'reading', data: reading })
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
      pause: () => {},
      resume: () => {},
      stop: () => {},
      rewind: () => {},
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

test('a duel narrows the window to its finalists', () => {
  const { state, hub, conn } = rig()
  const a = conn('player')
  const b = conn('player')
  const c = conn('player')
  joinAs(hub, a, 'A')
  joinAs(hub, b, 'B')
  joinAs(hub, c, 'C')
  state.round.candidates = [a.playerId!, b.playerId!]
  state.round.phase = 'ARMED'
  state.round.armedAt = Date.now() - 10
  hub.handle(c, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'ARMED', 'a spectator never opens the window')
  hub.handle(a, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'COLLECTING', 'a finalist buzzes through')
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
  await new Promise((r) => setTimeout(r, ARM_LEAD_MS + 5))
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
