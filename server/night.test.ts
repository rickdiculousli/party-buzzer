import { test as nodeTest, mock } from 'node:test'
import assert from 'node:assert/strict'
import { Hub, type Conn, type ReaderControls } from './hub.ts'
import { newState } from './state.ts'
import { MinigameRuntime } from './minigames/runtime.ts'
import type { HostAction, SetlistBlock } from '../shared/protocol.ts'

/** The night runs on the mock clock: `tick` advances timers and `Date.now()` together. */
function test(name: string, fn: () => void): void {
  nodeTest(name, () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] })
    try {
      fn()
    } finally {
      mock.timers.reset()
    }
  })
}

const tick = (ms: number) => mock.timers.tick(ms)

const QUIZ: SetlistBlock = { game: 'trivia', options: {}, count: 1, pack: 'p.txt' }
const BOW: SetlistBlock = { game: 'bow', options: { durationSec: 5, seed: 1 }, count: 1 }

/** A hub with two connected players, a real minigame runtime and a recording reader. */
function room(opts: { introSec?: number; nextSec?: number; autoplay?: boolean } = {}) {
  const state = newState()
  state.players = [
    { id: 'ada', name: 'Ada', connected: true },
    { id: 'bo', name: 'Bo', connected: true },
  ]
  const reads: number[] = []
  const said: string[] = []
  const reader: ReaderControls = {
    async select() {}, start() { reads.push(Date.now()) }, pause() {}, resume() {}, stop() {}, rewind() {},
    closeChoice() {}, announce(text) { said.push(text) },
  }
  const hub = new Hub(state, { reader })
  const runtime = new MinigameRuntime(state, {
    onState: (cause) => hub.minigameChanged(cause), onFrame() {}, onAck() {},
    onComplete: (matchId, results) => hub.completeMinigame(matchId, results),
  })
  hub.setMinigameRuntime(runtime)
  const conns = Object.fromEntries(['ada', 'bo'].map((id) => {
    const conn: Conn = { id, role: 'player', playerId: id, send() {} }
    hub.add(conn)
    return [id, conn]
  }))
  const dispatch = (action: HostAction) => hub.dispatch(action)
  if (opts.autoplay !== false) {
    dispatch({ a: 'setAutoplay', on: true, nextSec: opts.nextSec ?? 3, buzzSec: 10, reboundSec: 4, introSec: opts.introSec ?? 5 })
  }
  const ready = (id: string) => hub.handle(conns[id], { t: 'minigameLobby', change: { do: 'ready', on: true } })
  /** Play a started match to its results, as the runtime pump would. */
  const finishMatch = () => {
    tick(3_100)
    runtime.pump()
    tick(5_000 + 3_100)
    runtime.pump()
  }
  const timers = () => (hub as unknown as { night: Map<string, unknown> }).night.size
  const arrival = () => state.arrival
  return { state, hub, arrival, dispatch, ready, conns, reads, said, finishMatch, timers }
}

test('an introduction is raised for each fresh block under autoplay, and only the first without it', () => {
  const quiet = room({ autoplay: false })
  quiet.dispatch({ a: 'setSetlist', blocks: [QUIZ, QUIZ] })
  assert.equal(quiet.arrival()?.kind, 'introduction', 'a fresh start always introduces its first block')
  assert.deepEqual(quiet.said, [], 'and says nothing without autoplay')
  quiet.dispatch({ a: 'closeArrival', arrivalId: quiet.arrival()!.id })
  quiet.dispatch({ a: 'arm' })
  quiet.dispatch({ a: 'next' })
  assert.equal(quiet.state.setlist?.at, 1)
  assert.equal(quiet.arrival(), undefined, 'a later block waits for the host without autoplay')

  const r = room()
  r.dispatch({ a: 'setSetlist', blocks: [QUIZ, QUIZ, BOW] })
  const first = r.arrival()
  assert.equal(first?.kind === 'introduction' && first.blockKey, '0:trivia')
  r.dispatch({ a: 'closeArrival', arrivalId: r.arrival()!.id })
  r.dispatch({ a: 'arm' })
  r.dispatch({ a: 'next' })
  const intro = r.arrival()
  assert.ok(intro?.kind === 'introduction' && intro.blockAt === 1 && intro.blockKey === '1:trivia')
  assert.match(r.said.at(-1)!, /^Next: Trivia\./, 'the voice is asked to read it')
  r.dispatch({ a: 'setlistJump', at: 2 })
  const jumped = r.arrival()
  assert.ok(jumped?.kind === 'introduction' && jumped.blockKey === '2:bow', 'a jump introduces too')
  r.dispatch({ a: 'setlistJump', at: 3 })
  assert.equal(r.arrival(), undefined, 'a spent setlist has no block to introduce')
})

test('an introduction dismisses itself after introSec and starts the block reading', () => {
  const r = room({ introSec: 3 })
  r.dispatch({ a: 'setSetlist', blocks: [QUIZ] })
  tick(2_999)
  assert.equal(r.arrival()?.kind, 'introduction')
  assert.equal(r.reads.length, 0)
  tick(1)
  assert.equal(r.arrival(), undefined)
  assert.equal(r.reads.length, 1, 'the reader is started once the block may begin')
})

test('the host Continue cancels the timer: one dismissal, one start, nothing doubled', () => {
  const r = room({ introSec: 3 })
  let changes = 0
  r.hub.setOnChange(() => changes++)
  r.dispatch({ a: 'setSetlist', blocks: [QUIZ] })
  tick(1_000)
  r.dispatch({ a: 'closeArrival', arrivalId: r.arrival()!.id })
  assert.equal(r.reads.length, 1)
  const settled = changes
  tick(10_000)
  assert.equal(changes, settled, 'the old timer never fires')
  assert.equal(r.reads.length, 1)
  assert.equal(r.timers(), 0)
})

test('with autoplay off an introduction waits for the host and starts nothing', () => {
  const r = room({ autoplay: false })
  r.dispatch({ a: 'setSetlist', blocks: [QUIZ] })
  tick(120_000)
  assert.equal(r.arrival()?.kind, 'introduction')
  r.dispatch({ a: 'closeArrival', arrivalId: r.arrival()!.id })
  assert.equal(r.reads.length, 0)
  assert.equal(r.timers(), 0)
})

test('undo after a dismissal restores the introduction under a fresh id, with a full timer', () => {
  const r = room({ introSec: 4 })
  r.dispatch({ a: 'setSetlist', blocks: [QUIZ] })
  const first = r.arrival()!
  tick(4_000)
  assert.equal(r.arrival(), undefined)

  r.dispatch({ a: 'undo' })
  const back = r.arrival()
  assert.ok(back?.kind === 'introduction')
  assert.notEqual(back.id, first.id)
  assert.equal(back.blockKey, first.kind === 'introduction' ? first.blockKey : '')
  tick(3_999)
  assert.equal(r.arrival()?.id, back.id, 'it holds for the full introSec again')
  tick(1)
  assert.equal(r.arrival(), undefined)
})

test('a jump or a clear while an introduction is pending cancels its timer', () => {
  const r = room({ introSec: 4 })
  r.dispatch({ a: 'setSetlist', blocks: [QUIZ, QUIZ] })
  tick(3_000)
  r.dispatch({ a: 'setlistJump', at: 2 })
  assert.equal(r.arrival(), undefined)
  assert.equal(r.timers(), 0)
  tick(10_000)
  assert.equal(r.reads.length, 0, 'nothing fires later')

  r.dispatch({ a: 'setlistJump', at: 0 })
  assert.equal(r.timers(), 1)
  r.dispatch({ a: 'clearSetlist' })
  assert.equal(r.timers(), 0)
  tick(10_000)
  assert.equal(r.reads.length, 0)
})

test('a minigame block opens itself, starts when everyone is ready, and closes after its results', () => {
  const r = room({ introSec: 2, nextSec: 3 })
  r.dispatch({ a: 'setSetlist', blocks: [BOW, QUIZ] })
  assert.match(r.said.at(-1)!, /Bow\. .*Tap Ready\.$/)
  tick(2_000)
  assert.equal(r.arrival(), undefined)
  assert.equal(r.state.minigame?.id, 'bow', 'prepared with the block as its only input')
  assert.equal(r.state.minigame?.options.durationSec, 5)
  assert.equal(r.state.minigame?.phase, 'ready')
  assert.equal(r.reads.length, 0, 'a minigame block does not start the reader')

  r.ready('ada')
  assert.equal(r.state.minigame?.phase, 'ready', 'one of two is not everyone')
  r.ready('bo')
  assert.equal(r.state.minigame?.phase, 'countdown')

  r.finishMatch()
  assert.equal(r.state.minigame?.phase, 'results')
  tick(2_999)
  assert.equal(r.state.minigame?.phase, 'results')
  tick(1)
  assert.equal(r.state.minigame, undefined, 'closed after nextSec')
  assert.equal(r.state.setlist?.at, 1, 'and the setlist moved on')
  const second = r.arrival()
  assert.ok(second?.kind === 'introduction' && second.blockAt === 1)
  assert.match(r.said.at(-1)!, /^Next: Trivia\./)

  tick(2_000)
  assert.equal(r.reads.length, 1, 'the next block reads once its introduction is done')
  assert.equal(r.timers(), 0)
})

test('Ready waits for a connected player to join or leave, and 60 s starts the match anyway', () => {
  const r = room({ introSec: 0 })
  r.dispatch({ a: 'setSetlist', blocks: [BOW] })
  tick(0)
  assert.equal(r.state.minigame?.phase, 'ready')
  r.ready('ada')
  assert.equal(r.state.minigame?.phase, 'ready')
  r.hub.remove(r.conns.bo)
  assert.equal(r.state.minigame?.phase, 'countdown', 'the only connected player is ready')

  const late = room({ introSec: 0 })
  late.dispatch({ a: 'setSetlist', blocks: [BOW] })
  tick(0)
  tick(59_999)
  assert.equal(late.state.minigame?.phase, 'ready')
  tick(1)
  assert.equal(late.state.minigame?.phase, 'countdown')
  assert.equal(late.timers(), 0)
})

test('a start nobody can make yet is retried on the next change, not fought', () => {
  const r = room({ introSec: 0 })
  r.dispatch({ a: 'setSetlist', blocks: [BOW] })
  tick(0)
  r.state.players.forEach((p) => { p.connected = false })
  tick(60_000)
  assert.equal(r.state.minigame?.phase, 'ready', 'refused: no players')
  r.state.players[0].connected = true
  r.hub.handle(r.conns.ada, { t: 'hello', role: 'player', playerId: 'ada' })
  assert.equal(r.state.minigame?.phase, 'countdown', 'the first change after the wait starts it')
})

test('a host cancel is not fought, and a refused jump leaves the pending timers alone', () => {
  const r = room({ introSec: 0 })
  r.dispatch({ a: 'setSetlist', blocks: [BOW, QUIZ] })
  tick(0)
  assert.deepEqual(r.dispatch({ a: 'setlistJump', at: 1 }), { status: 'refused', reason: 'minigame-active' })
  assert.equal(r.timers(), 1, 'the fallback still waits')
  r.ready('ada')
  r.ready('bo')
  r.dispatch({ a: 'cancelMinigame' })
  assert.equal(r.state.minigame?.phase, 'ready')
  r.ready('ada')
  r.ready('bo')
  tick(120_000)
  assert.equal(r.state.minigame?.phase, 'ready', 'a cancelled match is the host\'s again')
  assert.equal(r.timers(), 0)
})

test('closing a result by hand leaves no stale dwell to close the next block', () => {
  const r = room({ introSec: 30, nextSec: 2 })
  r.dispatch({ a: 'setSetlist', blocks: [BOW, QUIZ, QUIZ] })
  tick(30_000)
  r.ready('ada')
  r.ready('bo')
  r.finishMatch()
  assert.equal(r.state.minigame?.phase, 'results')
  r.dispatch({ a: 'closeMinigame' })
  const intro = r.arrival()
  assert.equal(r.state.setlist?.at, 1)
  tick(2_000)
  assert.equal(r.state.setlist?.at, 1)
  assert.equal(r.arrival()?.id, intro?.id, 'the new introduction runs its own clock')
})

test('turning autoplay off cancels everything pending', () => {
  const r = room({ introSec: 4 })
  r.dispatch({ a: 'setSetlist', blocks: [QUIZ] })
  assert.equal(r.timers(), 1)
  r.dispatch({ a: 'setAutoplay', on: false, nextSec: 3, buzzSec: 10, reboundSec: 4, introSec: 4 })
  assert.equal(r.timers(), 0)
  tick(10_000)
  assert.equal(r.arrival()?.kind, 'introduction')
})
