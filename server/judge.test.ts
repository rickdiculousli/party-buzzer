import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hub, type Conn } from './hub.ts'
import { newState } from './state.ts'
import { Judge, type Transcribe } from './judge.ts'
import { Reader } from './reader.ts'
import type { Speech } from './speech.ts'
import { ARM_DELAY_MS } from '../shared/protocol.ts'

const hostConn: Conn = { id: 'h', role: 'host', send: () => {} }

function rig(transcribe: Transcribe = async () => 'unused') {
  const state = newState()
  state.answerWindowSec = 0 // open-ended unless a test asks for a timeout
  const hub = new Hub(state, { collectMs: 40, revealMs: 10 })
  const judge = new Judge(hub, { transcribe })
  hub.setOnChange(() => judge.onStateChange())
  const ada: Conn = { id: 'a', role: 'player', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada' })
  return { state, hub, judge, ada }
}

/** Arm, buzz Ada the instant the buzzers open, and wait out the lock. */
async function lockIn(hub: Hub, ada: Conn): Promise<void> {
  hub.handle(hostConn, { t: 'host', action: { a: 'arm' } })
  const armedAt = hub.state.round.armedAt
  await sleep(armedAt - Date.now() + 5)
  hub.handle(ada, { t: 'buzz', at: armedAt })
  await sleep(80) // collectMs 40 + slack
  assert.equal(hub.state.round.phase, 'LOCKED')
}

test('a lock while primed opens the window; open-ended when the timeout is off', async () => {
  const { state, hub, judge, ada } = rig()
  judge.prime(['Vermont'])
  await lockIn(hub, ada)
  assert.deepEqual(state.round.judge, {})
})

test('a timeout setting puts a server-domain deadline on the window', async () => {
  const { state, hub, judge, ada } = rig()
  state.answerWindowSec = 5
  judge.prime(['Vermont'])
  const before = Date.now()
  await lockIn(hub, ada)
  const until = state.round.judge?.until ?? 0
  assert.ok(until >= before + 5000 && until <= Date.now() + 5000, `until=${until}`)
})

test('a matching answer scores correct through the ordinary host path', async () => {
  const { state, hub, judge, ada } = rig()
  judge.prime(['Vermont', 'VT'])
  await lockIn(hub, ada)
  const res = await judge.submit(ada.playerId!, Buffer.from('uh, vermont?'), true)
  assert.deepEqual(res, { ok: true, hit: true, transcript: 'uh, vermont?' })
  assert.equal(state.round.phase, 'IDLE')
  assert.deepEqual(state.round.award, { name: 'Ada', points: 100 })
  assert.equal(state.scores[ada.playerId!], 100)
  assert.deepEqual(state.round.spoken, { name: 'Ada', transcript: 'uh, vermont?', hit: true })
  assert.equal(state.round.judge, undefined, 'the verdict ended the window')
})

test('a miss is a wrong at full value, and the rebound re-arms', async () => {
  const { state, hub, judge, ada } = rig()
  judge.prime(['Vermont'])
  await lockIn(hub, ada)
  const res = await judge.submit(ada.playerId!, Buffer.from('new hampshire'), true)
  assert.deepEqual(res, { ok: true, hit: false, transcript: 'new hampshire' })
  assert.equal(state.round.phase, 'ARMED', 'rebound')
  assert.equal(state.scores[ada.playerId!], -100)
  assert.equal(state.round.judge, undefined)
  assert.deepEqual(state.round.spoken, { name: 'Ada', transcript: 'new hampshire', hit: false })
})

test('with the box driving, a miss holds the rebound shut until it is opened', async () => {
  const { state, hub, judge, ada } = rig()
  // The two halves of "the reader is in the loop and will open it".
  state.autoplay = { on: true, nextSec: 5, reboundSec: 4 }
  state.reading = {
    pack: 'p.txt', qIndex: 0, qTotal: 1, fragIndex: 0, fragTotal: 1,
    paused: false, running: true,
  }
  judge.prime(['Vermont'])
  await lockIn(hub, ada)
  await judge.submit(ada.playerId!, Buffer.from('new hampshire'), true)

  assert.equal(state.round.held, true, 'held, not armed')
  assert.equal(state.round.phase, 'LOCKED')
  assert.equal(state.scores[ada.playerId!], -100, 'scored all the same')

  // The caveat this exists for: the leader is gone, so the judge has nobody to
  // re-offer the window to even though the phase is still LOCKED.
  await sleep(20)
  assert.equal(state.round.judge, undefined, 'no window reopens during the hold')

  // And nobody may buzz into it. This was the whole point — the old rebound
  // opened on the verdict, seconds before the room could know.
  const bo: Conn = { id: 'b', role: 'player', send: () => {} }
  hub.handle(bo, { t: 'hello', role: 'player', name: 'Bo' })
  hub.handle(bo, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.order.length, 0, 'the buzz is refused')

  // The transcript is the hold: it is what the room is looking at while the
  // buzzers are shut, and it comes down when they open, because the clue
  // resumes in the same instant and would otherwise be read under it in red.
  assert.deepEqual(
    state.round.spoken,
    { name: 'Ada', transcript: 'new hampshire', hit: false },
    'up for all of the hold',
  )
  hub.handle(hostConn, { t: 'host', action: { a: 'rebound' } })
  assert.equal(state.round.phase, 'ARMED', 'now it opens')
  assert.equal(state.round.held, undefined)
  assert.ok(state.round.armedAt > Date.now(), 'and it is scheduled ahead, like any arm')
  assert.equal(state.round.spoken, undefined, 'and the miss comes down with it')
})

test('a rebound nobody held keeps the transcript until someone takes the question', async () => {
  // Autoplay off, or a host judging by hand: `wrong` re-arms in the same tick
  // the judge published the transcript, so clearing it on the arm would mean
  // the room never read it. It stays until Bo presses.
  const { state, hub, judge, ada } = rig()
  judge.prime(['Vermont'])
  await lockIn(hub, ada)
  await judge.submit(ada.playerId!, Buffer.from('new hampshire'), true)
  assert.equal(state.round.phase, 'ARMED', 'rebound, unheld')
  assert.equal(state.round.spoken?.transcript, 'new hampshire')

  const bo: Conn = { id: 'b', role: 'player', send: () => {} }
  hub.handle(bo, { t: 'hello', role: 'player', name: 'Bo' })
  await sleep(ARM_DELAY_MS + 5)
  hub.handle(bo, { t: 'buzz', at: Date.now() })
  assert.equal(state.round.phase, 'COLLECTING', 'Bo is in')
  assert.equal(state.round.spoken, undefined, 'and the miss goes with the handover')
})

test('silence past the window lapses to the same wrong', async () => {
  const { state, hub, judge, ada } = rig()
  // Sub-second, poked directly: the setAnswerWindow action is whole seconds,
  // and no test should wait five of them.
  state.answerWindowSec = 0.05
  judge.prime(['Vermont'])
  await lockIn(hub, ada)
  await sleep(150)
  assert.equal(state.round.phase, 'ARMED', 'lapsed to a rebound')
  assert.equal(state.scores[ada.playerId!], -100)
  assert.deepEqual(state.round.spoken, { name: 'Ada', transcript: '', hit: false })
})

test('anything that is not the leader in the open window is refused', async () => {
  const { hub, judge, ada } = rig()
  const bo: Conn = { id: 'b', role: 'player', send: () => {} }
  hub.handle(bo, { t: 'hello', role: 'player', name: 'Bo' })
  judge.prime(['Vermont'])
  assert.deepEqual(await judge.submit(ada.playerId!, Buffer.from('x'), true), { ok: false },
    'no window open yet')
  await lockIn(hub, ada)
  assert.deepEqual(await judge.submit(bo.playerId!, Buffer.from('vermont'), true), { ok: false },
    'not the leader')
})

test('a host W mid-transcription wins; the late verdict drops in the judge', async () => {
  let release: (t: string | null) => void = () => {}
  const slow: Transcribe = () => new Promise((r) => (release = r))
  const { state, hub, judge, ada } = rig(slow)
  judge.prime(['Vermont'])
  await lockIn(hub, ada)
  const pending = judge.submit(ada.playerId!, Buffer.from('RIFF….'), false)
  await sleep(10)
  hub.handle(hostConn, { t: 'host', action: { a: 'wrong', neg: 100 } })
  assert.equal(state.round.phase, 'ARMED')
  release('vermont')
  assert.deepEqual(await pending, { ok: false })
  assert.equal(state.round.phase, 'ARMED', 'the late verdict did not score')
  assert.equal(state.round.spoken, undefined, 'nor showed its transcript')
  assert.equal(state.scores[ada.playerId!], -100, 'and did not dock twice')
  assert.equal(state.round.lockedOut.length, 1)
})

test('the audio path hands transcribe a wav file and cleans it up', async () => {
  let seen = ''
  const peek: Transcribe = async (path) => {
    seen = path
    assert.ok(existsSync(path), 'the file exists while transcribe runs')
    return 'VT'
  }
  const { state, hub, judge, ada } = rig(peek)
  judge.prime(['Vermont', 'VT'])
  await lockIn(hub, ada)
  const res = await judge.submit(ada.playerId!, Buffer.from('RIFF….'), false)
  assert.equal(res.ok, true)
  assert.ok(seen.endsWith('.wav'))
  assert.equal(existsSync(seen), false, 'the temp file is gone afterwards')
  assert.equal(state.round.award?.points, 100)
})

test('a transcription slower than the rebound does not score the new leader', async () => {
  let release: (t: string | null) => void = () => {}
  const slow: Transcribe = () => new Promise((r) => (release = r))
  const { state, hub, judge, ada } = rig(slow)
  const bo: Conn = { id: 'b', role: 'player', send: () => {} }
  hub.handle(bo, { t: 'hello', role: 'player', name: 'Bo' })
  judge.prime(['Vermont'])
  await lockIn(hub, ada)
  const pending = judge.submit(ada.playerId!, Buffer.from('RIFF….'), false)
  await sleep(10)
  // The host wrongs Ada and the rebound locks Bo before the transcript returns.
  hub.handle(hostConn, { t: 'host', action: { a: 'wrong', neg: 100 } })
  assert.equal(state.round.phase, 'ARMED')
  const armedAt = state.round.armedAt
  await sleep(armedAt - Date.now() + 5)
  hub.handle(bo, { t: 'buzz', at: armedAt })
  await sleep(80)
  assert.equal(state.round.phase, 'LOCKED')
  assert.equal(state.round.order[0]?.playerId, bo.playerId)

  release('vermont')
  assert.deepEqual(await pending, { ok: false })
  assert.equal(state.round.spoken, undefined, 'the stale transcript never showed')
  assert.equal(state.round.phase, 'LOCKED', "Bo's round is undisturbed")
  assert.equal(state.scores[bo.playerId!], 0)
  assert.equal(state.scores[ada.playerId!], -100, "Ada's dock stands, no double")
})

/** Speech that plays instantly. Same fake as reader.test.ts. */
function fakeSpeech(): Speech {
  return {
    render: async (_dir, text) => ({ path: `/fake/${text}`, durationMs: 10 }),
    play: () => ({ done: Promise.resolve(), started: Promise.resolve(), stop: () => {} }),
  }
}

test('the reader primes at arm and unprimes at stop — the full loop in-process', async () => {
  const packDir = mkdtempSync(join(tmpdir(), 'pb-judge-'))
  writeFileSync(join(packDir, 'one.txt'), 'A question. / More of it.\nA: gold | the gold one\n')
  const state = newState()
  state.answerWindowSec = 0
  const hub = new Hub(state, { collectMs: 40, revealMs: 10 })
  const judge = new Judge(hub, { transcribe: async () => 'unused' })
  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache'), speech: fakeSpeech(), judge })
  hub.setOnChange((s) => {
    reader.onStateChange(s)
    judge.onStateChange()
  })
  const ada: Conn = { id: 'a', role: 'player', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada' })

  await reader.select('one.txt')
  reader.start()
  await sleep(ARM_DELAY_MS + 30)
  await lockIn(hub, ada)
  assert.ok(state.round.judge !== undefined, 'primed at arm, the window opened')

  const res = await judge.submit(ada.playerId!, Buffer.from('the gold one'), true)
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.hit, true)

  reader.stop()
  await reader.settled()
  assert.equal(state.round.judge, undefined, 'stop unprimed and closed')
})
