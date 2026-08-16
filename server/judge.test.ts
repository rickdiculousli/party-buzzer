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
import { ARM_LEAD_MS } from '../shared/protocol.ts'

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

test('a host W mid-transcription wins; the late verdict drops on the phase guard', async () => {
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
  const res = await pending
  assert.equal(res.ok, true)
  assert.equal(state.round.phase, 'ARMED', 'the late verdict did not score')
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

/** Speech that plays instantly. Same fake as reader.test.ts. */
function fakeSpeech(): Speech {
  return {
    render: async (_dir, text) => ({ path: `/fake/${text}`, durationMs: 10 }),
    play: () => ({ done: Promise.resolve(), stop: () => {} }),
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
  await sleep(ARM_LEAD_MS + 30)
  await lockIn(hub, ada)
  assert.ok(state.round.judge !== undefined, 'primed at arm, the window opened')

  const res = await judge.submit(ada.playerId!, Buffer.from('the gold one'), true)
  assert.equal(res.ok, true)
  if (res.ok) assert.equal(res.hit, true)

  reader.stop()
  await reader.settled()
  assert.equal(state.round.judge, undefined, 'stop unprimed and closed')
})
