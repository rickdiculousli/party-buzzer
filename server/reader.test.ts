import { test as nodeTest, mock } from 'node:test'
import type { TestOptions } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hub } from './hub.ts'
import { newState } from './state.ts'
import { Reader } from './reader.ts'
import type { Speech } from './speech.ts'
import { ARM_DELAY_MS, COLLECT_MS } from '../shared/protocol.ts'

/**
 * Every test runs on a mock clock: `wait(ms)` advances timers and `Date.now()`
 * together, then yields to the event loop so promises and file reads settle.
 */
const STEP_MS = 5

function test(name: string, fn: () => Promise<void>): void
function test(name: string, opts: TestOptions, fn: (t: import('node:test').TestContext) => Promise<void>): void
function test(name: string, a: TestOptions | (() => Promise<void>), b?: (t: import('node:test').TestContext) => Promise<void>) {
  const opts = typeof a === 'function' ? {} : a
  const fn = (typeof a === 'function' ? a : b) as (t: import('node:test').TestContext) => Promise<void>
  nodeTest(name, opts, async (t) => {
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
    try {
      await fn(t)
    } finally {
      mock.timers.reset()
    }
  })
}

async function wait(ms: number) {
  // Small steps, so work that waits on a timer and then on file I/O keeps pace.
  for (let left = ms; left > 0; left -= STEP_MS) {
    mock.timers.tick(Math.min(STEP_MS, left))
    await new Promise((r) => setImmediate(r))
  }
}

/** Drives the clock until the reader's loop has finished. */
async function settled(reader: Reader) {
  let done = false
  const finished = reader.settled().then(() => { done = true })
  while (!done) await wait(STEP_MS)
  await finished
}

/** Speech that plays instantly and records what it was asked to say. */
function fakeSpeech(): Speech & { spoken: string[] } {
  const spoken: string[] = []
  return {
    spoken,
    render: async (_dir, text) => ({ path: `/fake/${text}`, durationMs: 10 }),
    play: (path) => {
      spoken.push(path.replace('/fake/', ''))
      return { done: Promise.resolve(), started: Promise.resolve(), stop: () => {} }
    },
  }
}

function rig(packBody: string) {
  const packDir = mkdtempSync(join(tmpdir(), 'pb-reader-'))
  writeFileSync(join(packDir, 'one.txt'), packBody)
  const state = newState()
  const hub = new Hub(state)
  const speech = fakeSpeech()
  const reader = new Reader(hub, {
    packDir,
    cacheDir: join(packDir, '.cache'),
    speech,
  })
  hub.setOnChange((s) => reader.onStateChange(s))
  hub.setReader(reader)
  return { hub, state, reader, speech }
}

const PACK = 'V: 300\nFirst fragment. / Second fragment.\nA: gold\n'

test('selecting a pack renders every fragment and publishes progress', async () => {
  const { state, reader } = rig(PACK)
  await reader.select('one.txt')
  assert.equal(state.reading?.pack, 'one.txt')
  assert.equal(state.reading?.qTotal, 1)
  assert.equal(state.reading?.rendering, undefined, 'rendering clears when done')
})

test('the host waits for the first question, not the whole pack', async () => {
  const packDir = mkdtempSync(join(tmpdir(), 'pb-warm-'))
  writeFileSync(packDir + '/one.txt', 'V: 100\nAlpha.\nA: a\n\nV: 100\nBeta.\nA: b\n')
  const held: (() => void)[] = []
  const state = newState()
  const hub = new Hub(state)
  const speech: Speech = {
    // Alpha comes back at once; Beta hangs until the test lets it go.
    render: async (_dir, text) => {
      if (text.startsWith('Beta')) await new Promise<void>((r) => held.push(r))
      return { path: `/fake/${text}`, durationMs: 10 }
    },
    play: () => ({ done: Promise.resolve(), started: Promise.resolve(), stop: () => {} }),
  }
  const reader = new Reader(hub, { packDir, cacheDir: packDir + '/.cache', speech })
  hub.setOnChange((s) => reader.onStateChange(s))
  hub.setReader(reader)

  await reader.select('one.txt') // returns on the first question, not the last
  assert.equal(state.reading?.qTotal, 2)
  assert.deepEqual(state.reading?.rendering, { done: 1, total: 2 }, 'the rest is still coming')

  reader.start()
  while (!state.round.fragments?.length) await wait(5)
  assert.deepEqual(state.round.fragments, ['Alpha.'], 'question one plays against a half-made pack')

  // Question two must not arm onto a clip that does not exist yet.
  hub.handle({ id: 'h', role: 'host', send: () => {} }, { t: 'host', action: { a: 'next' } })
  await wait(ARM_DELAY_MS + 40)
  assert.equal(state.round.fragments?.length ?? 0, 0, 'nothing spoken while it is unrendered')

  held.forEach((r) => r())
  while (!state.round.fragments?.length) await wait(5)
  assert.deepEqual(state.round.fragments, ['Beta.'], 'and it reads once the audio lands')
  reader.stop()
  await settled(reader)
})

test('reading a question arms it, speaks each fragment, and pushes them in order', async () => {
  const { state, reader, speech } = rig(PACK)
  await reader.select('one.txt')
  reader.start()
  // Nothing judges this question — real quizbowl leaves it ARMED so a late
  // buzz still lands. fakeSpeech is instant, but arming has a countdown, so
  // poll for both fragments rather than guess a delay.
  while (speech.spoken.length < 2) await wait(5)
  reader.stop()
  await settled(reader)

  assert.equal(state.round.value, 300, 'the pack value drives the round')
  assert.deepEqual(speech.spoken, ['First fragment.', 'Second fragment.'])
  assert.deepEqual(state.round.fragments, ['First fragment.', 'Second fragment.'])
})

test('power closes after the configured fragment', async () => {
  const { hub, state, reader } = rig(PACK)
  hub.handle({ id: 'h', role: 'host', send: () => {} }, {
    t: 'host',
    action: { a: 'setMode', id: 'quizbowl', options: { powerAfterFragment: 1 } },
  })
  await reader.select('one.txt')
  reader.start()
  while (
    (state.game.moduleState as { powerEndsAt?: number }).powerEndsAt === undefined
  ) {
    await wait(5)
  }
  reader.stop()
  await settled(reader)

  const ms = state.game.moduleState as { powerEndsAt?: number }
  assert.ok(ms.powerEndsAt, 'the mode closed power at the fragment boundary')
})

test('pausing an unfinished fragment does not complete the mode boundary', { timeout: 3000 }, async (t) => {
  const { hub, reader, speech } = rig(PACK)
  t.after(() => reader.stop())
  let finish = () => {}
  speech.play = (path) => {
    speech.spoken.push(path)
    const done = new Promise<void>((resolve) => { finish = resolve })
    return { done, started: Promise.resolve(), stop: finish }
  }
  hub.dispatch({ a: 'setMode', id: 'quizbowl', options: { powerAfterFragment: 1 } })
  const host = { id: 'h', role: 'host' as const, send() {} }
  await reader.select('one.txt')
  reader.start()
  while (speech.spoken.length < 1) await wait(5)
  reader.pause()
  await wait(10)
  assert.equal(hub.viewFor(host).game.status?.label, 'Power open')
  reader.resume()
  while (speech.spoken.length < 2) await wait(5)
  assert.equal(hub.viewFor(host).game.status?.label, 'Power open')
  finish()
  while (hub.viewFor(host).game.status?.label !== 'Power ended') await wait(5)
  assert.equal(speech.spoken[0], speech.spoken[1], 'the interrupted fragment was replayed before completion')
})

test('an undo mid-question aborts the reader instead of pushing onto a dead round', async () => {
  const { hub, state, reader, speech } = rig(
    'One. / Two. / Three.\nA: a\n',
  )
  await reader.select('one.txt')
  reader.start()
  // Re-arm under the reader's feet: a new arm stamp means a different round.
  await wait(5)
  hub.handle({ id: 'h', role: 'host', send: () => {} }, { t: 'host', action: { a: 'arm' } })
  await settled(reader)

  assert.ok(
    speech.spoken.length < 3,
    `expected the reader to abort, but it spoke all of ${speech.spoken.length}`,
  )
})

test('replacing a question after its clue ends aborts the old answer wait', async () => {
  const { hub, state, reader } = rig(PACK)
  await reader.select('one.txt')
  reader.start()
  while ((state.round.fragments?.length ?? 0) < 2) await wait(5)
  await wait(5)
  hub.handle({ id: 'h', role: 'host', send() {} }, { t: 'host', action: { a: 'arm' } })
  await settled(reader)
  assert.equal(state.round.answer, undefined)
  assert.equal(state.round.fragments, undefined)
  assert.equal(state.reading, undefined)
  assert.equal(state.round.phase, 'ARMED')
})

test('pause kills the clip and resume replays that fragment, not the next one', async () => {
  const { reader, speech } = rig(PACK)
  // Clips that run until something stops them, so pause lands mid-fragment.
  speech.play = (path) => {
    speech.spoken.push(path.replace('/fake/', ''))
    let end = () => {}
    return { done: new Promise<void>((r) => (end = r)), started: Promise.resolve(), stop: () => end() }
  }
  await reader.select('one.txt')
  reader.start()
  while (speech.spoken.length < 1) await wait(5)

  reader.pause()
  await wait(20)
  assert.deepEqual(speech.spoken, ['First fragment.'], 'paused, not advanced')

  reader.resume()
  while (speech.spoken.length < 2) await wait(5)
  reader.stop()
  await settled(reader)
  assert.deepEqual(speech.spoken[1], 'First fragment.', 'the same fragment again')
})

test('a buzz cuts the clip at once, and the rest of the clue is never read', async () => {
  const { hub, reader, speech } = rig(PACK)
  let stopped = 0
  speech.play = (path) => {
    speech.spoken.push(path.replace('/fake/', ''))
    let end = () => {}
    return { done: new Promise<void>((r) => (end = r)), started: Promise.resolve(), stop: () => { stopped++; end() } }
  }
  await reader.select('one.txt')
  reader.start()
  while (speech.spoken.length < 1) await wait(5)

  const host = { id: 'h', role: 'host' as const, send: () => {} }
  hub.handle({ id: 'p', role: 'player', playerId: 'p1', send: () => {} }, { t: 'hello', role: 'player', name: 'Ada', playerId: 'p1' })
  await wait(ARM_DELAY_MS + 20)
  hub.handle({ id: 'p', role: 'player', playerId: 'p1', send: () => {} }, { t: 'buzz', at: Date.now() })
  assert.equal(stopped, 1, 'the voice is killed on the buzz itself, not a tick later')

  // Judged correct: the second fragment must never be spoken.
  await wait(40)
  hub.handle(host, { t: 'host', action: { a: 'correct' } })
  await wait(40)
  assert.deepEqual(speech.spoken, ['First fragment.'], 'the clue stops where the buzz did')

  reader.stop()
  await settled(reader)
})

test('a wrong answer rebounds and the interrupted fragment is re-read', async () => {
  const { hub, reader, speech } = rig(PACK)
  speech.play = (path) => {
    speech.spoken.push(path.replace('/fake/', ''))
    let end = () => {}
    return { done: new Promise<void>((r) => (end = r)), started: Promise.resolve(), stop: () => end() }
  }
  await reader.select('one.txt')
  reader.start()
  while (speech.spoken.length < 1) await wait(5)

  const host = { id: 'h', role: 'host' as const, send: () => {} }
  const ada = { id: 'p', role: 'player' as const, playerId: 'p1', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada', playerId: 'p1' })
  await wait(ARM_DELAY_MS + 20)
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  await wait(COLLECT_MS + 30)
  hub.handle(host, { t: 'host', action: { a: 'wrong', neg: 0 } })

  while (speech.spoken.length < 2) await wait(5)
  reader.stop()
  await settled(reader)
  assert.equal(speech.spoken[1], 'First fragment.', 'the cut fragment, from its start')
})

/** Turn autoplay on with dwells short enough to test against. */
function autoplay(hub: Hub, nextSec: number, reboundSec: number, introSec = 0.1): void {
  hub.handle({ id: 'h', role: 'host', send: () => {} }, {
    t: 'host',
    action: { a: 'setAutoplay', on: true, nextSec, buzzSec: nextSec, reboundSec, introSec },
  })
}

test('autoplay presses N itself: the payoff sits, then the next question arms', async () => {
  const { hub, state, reader, speech } = rig(
    'One.\nA: gold\n\nTwo.\nA: silver\n',
  )
  // Long enough that the dead-air pass can't beat the buzz to it.
  autoplay(hub, 1.5, 0)
  await reader.select('one.txt')
  reader.start()

  const host = { id: 'h', role: 'host' as const, send: () => {} }
  const ada = { id: 'p', role: 'player' as const, playerId: 'p1', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada', playerId: 'p1' })
  await wait(ARM_DELAY_MS + 30)
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  await wait(COLLECT_MS + 30)
  hub.handle(host, { t: 'host', action: { a: 'correct' } })
  assert.ok(state.round.award, 'the payoff is on the wall')

  // Nobody presses N. The reader does.
  while (speech.spoken.length < 2) await wait(5)
  reader.stop()
  await settled(reader)
  assert.equal(speech.spoken[1], 'Two.', 'it moved on by itself')
})

test('autoplay passes a question nobody buzzed rather than waiting forever', async () => {
  const { hub, reader, speech } = rig('One.\nA: gold\n\nTwo.\nA: silver\n')
  autoplay(hub, 0.1, 0)
  await reader.select('one.txt')
  reader.start()
  while (!hub.state.round.closesAt) await wait(5)
  while (hub.state.round.phase !== 'IDLE') await wait(5)
  assert.equal(hub.state.round.answer, 'gold', 'the answer goes up as the buzzers shut')
  assert.ok(hub.state.round.questionId, 'the question stays up for it')
  while (speech.spoken.length < 2) await wait(5)
  reader.stop()
  await settled(reader)
  assert.deepEqual(speech.spoken, ['One.', 'Two.'], 'dead air passed on its own')
})

test('with autoplay off, dead air waits for the host and nothing advances', async () => {
  const { reader, speech } = rig('One.\nA: gold\n\nTwo.\nA: silver\n')
  await reader.select('one.txt')
  reader.start()
  await wait(ARM_DELAY_MS + 200)
  assert.deepEqual(speech.spoken, ['One.'], 'still holding on the host')
  reader.stop()
  await settled(reader)
})

test('autoplay pauses before the clue picks up on a rebound', async () => {
  const { hub, reader, speech } = rig(PACK)
  speech.play = (path) => {
    speech.spoken.push(path.replace('/fake/', ''))
    let end = () => {}
    return { done: new Promise<void>((r) => (end = r)), started: Promise.resolve(), stop: () => end() }
  }
  autoplay(hub, 5, 0.3)
  await reader.select('one.txt')
  reader.start()
  while (speech.spoken.length < 1) await wait(5)

  const host = { id: 'h', role: 'host' as const, send: () => {} }
  const ada = { id: 'p', role: 'player' as const, playerId: 'p1', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada', playerId: 'p1' })
  await wait(ARM_DELAY_MS + 20)
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  await wait(COLLECT_MS + 30)
  hub.handle(host, { t: 'host', action: { a: 'wrong', neg: 0 } })

  await wait(150)
  assert.equal(speech.spoken.length, 1, 'the beat is still running')
  while (speech.spoken.length < 2) await wait(5)
  reader.stop()
  await settled(reader)
  assert.equal(speech.spoken[1], 'First fragment.', 'then the cut fragment resumes')
})

test('a penalty rides the rebound without the reader calling the question over', async () => {
  // The penalty stamps `round.award`, which is also what tells the reader a
  // question resolved. It must not: the buzzers are open again and the clue has
  // more to say. `resolved` gates on the phase for exactly this reason.
  const { hub, state, reader, speech } = rig(PACK)
  speech.play = (path) => {
    speech.spoken.push(path.replace('/fake/', ''))
    let end = () => {}
    return { done: new Promise<void>((r) => (end = r)), started: Promise.resolve(), stop: () => end() }
  }
  autoplay(hub, 5, 0)
  await reader.select('one.txt')
  reader.start()
  while (speech.spoken.length < 1) await wait(5)

  const host = { id: 'h', role: 'host' as const, send: () => {} }
  const ada = { id: 'p', role: 'player' as const, playerId: 'p1', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada', playerId: 'p1' })
  await wait(ARM_DELAY_MS + 20)
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  await wait(COLLECT_MS + 30)
  hub.handle(host, { t: 'host', action: { a: 'wrong', neg: 10 } })

  assert.deepEqual(
    state.round.award,
    { name: 'Ada', points: -10, penalty: true },
    'the penalty is up',
  )
  // Held, not open: with the box driving, the rebound waits out `reboundSec`
  // behind shut buzzers so the room reads the miss before it is racing on it.
  // This one is set to 0, so the reader opens it on its next turn.
  assert.equal(state.round.held, true, 'the rebound is the reader’s to open')
  assert.equal(state.round.phase, 'LOCKED', 'nobody may buzz on the verdict itself')
  assert.equal(state.round.answer, undefined, 'the answer is not revealed mid-rebound')

  while (hub.state.round.phase !== 'ARMED') await wait(5)
  assert.equal(state.round.held, undefined, 'and then the buzzers are open again')

  // The clue picks up where the buzz cut it rather than the reader moving on.
  while (speech.spoken.length < 2) await wait(5)
  assert.equal(speech.spoken[1], 'First fragment.', 'the cut fragment resumes')
  assert.deepEqual(state.round.award, { name: 'Ada', points: -10, penalty: true }, 'still up')
  assert.equal(state.round.answer, undefined, 'still not revealed')
  reader.stop()
  await settled(reader)
})

test('the pack running out turns autoplay off, and leaves the dwells alone', async () => {
  const { hub, state, reader } = rig('Only one.\nA: gold\n')
  autoplay(hub, 0.1, 3)
  await reader.select('one.txt')
  reader.start()
  await settled(reader)

  assert.equal(state.autoplay.on, false, 'nothing advances itself after the last question')
  assert.equal(state.autoplay.reboundSec, 3, 'the numbers survive for the next pack')
  assert.equal(state.reading, undefined, 'and the reader is done')
})

test('a setlist reads each block from its own pack, and keeps each pack its place', async () => {
  const packDir = mkdtempSync(join(tmpdir(), 'pb-reader-'))
  writeFileSync(join(packDir, 'a.txt'), 'A one.\nA: a\n\nA two.\nA: a\n')
  writeFileSync(join(packDir, 'b.txt'), 'B one.\nA: b\n')
  const state = newState()
  const hub = new Hub(state)
  const speech = fakeSpeech()
  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache'), speech })
  hub.setOnChange((s) => reader.onStateChange(s))
  hub.setReader(reader)

  hub.handle({ id: 'h', role: 'host', send: () => {} }, {
    t: 'host',
    action: {
      a: 'setSetlist',
      blocks: [
        { game: 'trivia', options: {}, count: 1, pack: 'a.txt' },
        { game: 'trivia', options: {}, count: 1, pack: 'b.txt' },
        { game: 'trivia', options: {}, count: 1, pack: 'a.txt' },
      ],
    },
  })
  hub.dispatch({ a: 'closeArrival', arrivalId: state.arrival!.id })
  autoplay(hub, 0.1, 0)
  reader.start()
  // Each seam raises an introduction that stops the reader and, once it
  // dismisses itself, starts it again; the night ends when the autoplay does.
  while (state.autoplay.on) await wait(5)
  await settled(reader)

  // Block 3 returns to pack A and gets its second question, not its first.
  assert.deepEqual(speech.spoken, ['A one.', 'B one.', 'A two.'])
})

test('a block with no pack ends the reading rather than reading the wrong one', async () => {
  const { hub, reader, speech } = rig('One.\nA: gold\n\nTwo.\nA: silver\n')
  hub.handle({ id: 'h', role: 'host', send: () => {} }, {
    t: 'host',
    action: {
      a: 'setSetlist',
      blocks: [
        { game: 'trivia', options: {}, count: 1, pack: 'one.txt' },
        { game: 'trivia', options: {}, count: 1 },
      ],
    },
  })
  hub.dispatch({ a: 'closeArrival', arrivalId: hub.state.arrival!.id })
  autoplay(hub, 0.1, 0)
  reader.start()
  await settled(reader)

  assert.deepEqual(speech.spoken, ['One.'], 'it stopped at the block it cannot read')
})

test('Read after a pack is spent starts it again', async () => {
  const { hub, reader, speech } = rig('Only one.\nA: gold\n')
  autoplay(hub, 0.1, 0)
  await reader.select('one.txt')
  reader.start()
  await settled(reader)
  assert.deepEqual(speech.spoken, ['Only one.'])

  reader.start()
  while (speech.spoken.length < 2) await wait(5)
  reader.stop()
  await settled(reader)
  assert.deepEqual(speech.spoken, ['Only one.', 'Only one.'], 'not a no-op button')
})

test('Read starts every spent pack over, not only the one it left off in', async () => {
  const packDir = mkdtempSync(join(tmpdir(), 'pb-reader-'))
  writeFileSync(join(packDir, 'a.txt'), 'A one.\nA: a\n')
  writeFileSync(join(packDir, 'b.txt'), 'B one.\nA: b\n')
  const state = newState()
  const hub = new Hub(state)
  const speech = fakeSpeech()
  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache'), speech })
  hub.setOnChange((s) => reader.onStateChange(s))
  hub.setReader(reader)
  hub.handle({ id: 'h', role: 'host', send: () => {} }, {
    t: 'host',
    action: {
      a: 'setSetlist',
      blocks: [
        { game: 'trivia', options: {}, count: 1, pack: 'a.txt' },
        { game: 'trivia', options: {}, count: 1, pack: 'b.txt' },
      ],
    },
  })
  hub.dispatch({ a: 'closeArrival', arrivalId: state.arrival!.id })
  autoplay(hub, 0.1, 0)

  reader.start()
  while (state.autoplay.on) await wait(5)
  await settled(reader)
  assert.deepEqual(speech.spoken, ['A one.', 'B one.'])

  // The run ended on b; a is spent too, and the setlist starts on it. Autoplay
  // switched itself off when the reading ran out, so a second night turns it
  // back on the same way the host would.
  hub.handle({ id: 'h', role: 'host', send: () => {} }, { t: 'host', action: { a: 'setlistJump', at: 0 } })
  autoplay(hub, 0.1, 0)
  reader.start()
  while (state.autoplay.on) await wait(5)
  await settled(reader)
  assert.deepEqual(
    speech.spoken,
    ['A one.', 'B one.', 'A one.', 'B one.'],
    'a second Read is the same night again, not a stall on a spent pack',
  )
})

test('stop halts the loop and clears reading progress', async () => {
  const { state, reader } = rig(PACK)
  await reader.select('one.txt')
  reader.start()
  reader.stop()
  await settled(reader)
  assert.equal(state.reading, undefined)
})

const tick = () => wait(5)

test('a shown question is on the board whole before the voice starts, and is still read', async () => {
  const { state, reader, speech } = rig('K: shown\nFirst fragment. / Second fragment.\nA: gold\n')
  let atFirstClip: string[] | undefined
  const play = speech.play
  speech.play = (path, at) => {
    atFirstClip ??= [...(state.round.fragments ?? [])]
    return play(path, at)
  }
  await reader.select('one.txt')
  reader.start()
  while (speech.spoken.length < 2) await tick()
  reader.stop()
  await settled(reader)
  assert.equal(state.round.kind, 'shown')
  assert.deepEqual(atFirstClip, ['First fragment.', 'Second fragment.'])
  assert.deepEqual(speech.spoken, ['First fragment.', 'Second fragment.'])
})

test('a shown question still closes quizbowl power as the voice passes the fragment', async () => {
  const { hub, state, reader } = rig('K: shown\nFirst fragment. / Second fragment.\nA: gold\n')
  hub.dispatch({ a: 'setMode', id: 'quizbowl', options: { powerAfterFragment: 1 } })
  await reader.select('one.txt')
  reader.start()
  while ((state.game.moduleState as { powerEndsAt?: number }).powerEndsAt === undefined) await tick()
  reader.stop()
  await settled(reader)
})

const CHOICE = 'V: 200\nC: Mars | Venus | Saturn\nWhich planet has the most moons?\nA: Saturn\n'

function withPhones(hub: Hub, ids: string[]) {
  return ids.map((id) => {
    const conn = { id, playerId: id, role: 'player' as const, send() {} }
    hub.handle(conn, { t: 'hello', role: 'player', name: id, playerId: id })
    return conn
  })
}

test('choices go up after the question, the options are read, and it settles when everyone has picked', async () => {
  const { hub, state, reader, speech } = rig(CHOICE)
  const [ada, bo] = withPhones(hub, ['ada', 'bo'])
  await reader.select('one.txt')
  reader.start()
  while (!state.round.choices) await tick()
  assert.equal(state.round.kind, 'choice')
  assert.equal(speech.spoken[0], 'Which planet has the most moons?', 'choices wait for the question')
  hub.handle(ada, { t: 'act', act: 'pick', data: 2 })
  const lastPick = Date.now()
  hub.handle(bo, { t: 'act', act: 'pick', data: 0 })
  while (state.round.correct === undefined) await tick()
  // A beat with every slot filled before the answer, never a reveal on the tap.
  assert.ok(Date.now() - lastPick >= 900, 'the room sees the bar full first')
  assert.equal(state.round.correct, 2)
  assert.equal(state.scores.ada, 200)
  assert.equal(state.scores.bo ?? 0, 0)
  assert.ok(speech.spoken.includes('A, Mars. B, Venus. C, Saturn.'))
  reader.stop()
  await settled(reader)
})

test('a choice question settles when the timer runs out after the options are read', async () => {
  const { hub, state, reader } = rig(CHOICE)
  withPhones(hub, ['ada'])
  state.choiceSec = 0.05
  await reader.select('one.txt')
  reader.start()
  while (state.round.correct === undefined) await tick()
  assert.ok(state.round.closesAt, 'the countdown was published')
  reader.stop()
  await settled(reader)
})

test('the host closes picking early', async () => {
  const { hub, state, reader } = rig(CHOICE)
  hub.setReader(reader)
  withPhones(hub, ['ada'])
  await reader.select('one.txt')
  reader.start()
  while (!state.round.choices) await tick()
  hub.handle({ id: 'h', role: 'host', send: () => {} }, { t: 'act', act: 'closeChoice' })
  while (state.round.correct === undefined) await tick()
  reader.stop()
  await settled(reader)
})

test('autoplay moves on from a settled choice question', async () => {
  const { hub, state, reader, speech } = rig(CHOICE + '\nV: 100\nNext.\nA: x\n')
  const [ada] = withPhones(hub, ['ada'])
  hub.dispatch({ a: 'setAutoplay', on: true, nextSec: 0.01, buzzSec: 0.01, reboundSec: 0.01, introSec: 12 })
  await reader.select('one.txt')
  reader.start()
  while (!state.round.choices) await tick()
  hub.handle(ada, { t: 'act', act: 'pick', data: 2 })
  // The next question is armed, read and passed within a tick at a zero
  // dwell, so the voice is the evidence rather than the round.
  while (!speech.spoken.includes('Next.')) await tick()
  reader.stop()
  await settled(reader)
})

const CLOSEST = 'V: 200\nK: closest\nU: steps\nHow many steps are in the Eiffel Tower?\nA: 1,665\n'

test('guessing opens once the question is read and settles when everyone has guessed', async () => {
  const { hub, state, reader, speech } = rig(CLOSEST)
  const [ada, bo] = withPhones(hub, ['ada', 'bo'])
  await reader.select('one.txt')
  reader.start()
  while (!state.round.guessing) await tick()
  assert.equal(state.round.kind, 'closest')
  assert.equal(state.round.guessing.unit, 'steps')
  assert.ok(state.round.guessing.closesAt > Date.now(), 'the countdown starts with guessing')
  assert.deepEqual(speech.spoken, ['How many steps are in the Eiffel Tower?'])
  hub.handle(ada, { t: 'act', act: 'guess', data: 1700 })
  const last = Date.now()
  hub.handle(bo, { t: 'act', act: 'guess', data: 1200 })
  while (state.round.truth === undefined) await tick()
  assert.ok(Date.now() - last >= 900, 'the room sees the slots full first')
  assert.equal(state.round.truth, 1665)
  assert.equal(state.scores.ada, 200)
  assert.equal(state.scores.bo ?? 0, 0)
  reader.stop()
  await settled(reader)
})

test('a disconnected phone does not hold guessing open', async () => {
  const { hub, state, reader } = rig(CLOSEST)
  const [ada, bo] = withPhones(hub, ['ada', 'bo'])
  await reader.select('one.txt')
  reader.start()
  while (!state.round.guessing) await tick()
  hub.handle(ada, { t: 'act', act: 'guess', data: 1600 })
  hub.remove(bo)
  while (state.round.truth === undefined) await tick()
  assert.equal(state.scores.ada, 200)
  reader.stop()
  await settled(reader)
})

test('a closest question settles when the timer runs out, or on the host\'s Close', async () => {
  for (const close of [false, true]) {
    const { hub, state, reader } = rig(CLOSEST)
    hub.setReader(reader)
    withPhones(hub, ['ada'])
    state.choiceSec = close ? 60 : 0.05
    await reader.select('one.txt')
    reader.start()
    while (!state.round.guessing) await tick()
    if (close) hub.handle({ id: 'h', role: 'host', send: () => {} }, { t: 'act', act: 'closeChoice' })
    while (state.round.truth === undefined) await tick()
    assert.deepEqual(state.round.paid, {}, 'nobody guessed, nobody paid')
    reader.stop()
    await settled(reader)
  }
})

test('a quip on a right answer does not stall autoplay', { timeout: 5000 }, async () => {
  const packDir = mkdtempSync(join(tmpdir(), 'pb-reader-quip-'))
  writeFileSync(join(packDir, 'one.txt'), 'One.\nR: Nice.\nA: gold\n\nTwo.\nA: silver\n')
  const state = newState()
  const hub = new Hub(state)
  const speech = fakeSpeech()
  const reader = new Reader(hub, {
    packDir,
    cacheDir: join(packDir, '.cache'),
    speech,
    perform: true,
    quips: { pools: { correct: [], wrong: [], nobody: [] } },
  })
  hub.setOnChange((s) => reader.onStateChange(s))
  hub.setReader(reader)
  autoplay(hub, 0.2, 0)
  await reader.select('one.txt')
  reader.start()

  const host = { id: 'h', role: 'host' as const, send: () => {} }
  const ada = { id: 'p', role: 'player' as const, playerId: 'p1', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada', playerId: 'p1' })
  await wait(ARM_DELAY_MS + 30)
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  await wait(COLLECT_MS + 30)
  hub.handle(host, { t: 'host', action: { a: 'correct' } })

  while (speech.spoken.length < 3) await wait(5)
  reader.stop()
  await settled(reader)
  assert.deepEqual(speech.spoken, ['One.', 'Nice.', 'Two.'], 'the quip played and the next question followed')
})

test('a pool quip plays its own whole take, not a cut of the pool', { timeout: 5000 }, async (t) => {
  // The picker always quips and takes the first open line.
  t.mock.method(Math, 'random', () => 0)
  const packDir = mkdtempSync(join(tmpdir(), 'pb-reader-pool-'))
  writeFileSync(join(packDir, 'one.txt'), 'One.\nA: gold\n\nTwo.\nA: silver\n')
  const state = newState()
  const hub = new Hub(state)
  const speech = fakeSpeech()
  const reader = new Reader(hub, {
    packDir,
    cacheDir: join(packDir, '.cache'),
    speech,
    perform: true,
    quips: { pools: { correct: [{ text: '[snickers] Okay.', sincere: false }, { text: 'Fine.', sincere: false }], wrong: [], nobody: [] } },
  })
  hub.setOnChange((s) => reader.onStateChange(s))
  hub.setReader(reader)
  autoplay(hub, 0.2, 0)
  await reader.select('one.txt')
  reader.start()

  const host = { id: 'h', role: 'host' as const, send: () => {} }
  const ada = { id: 'p', role: 'player' as const, playerId: 'p1', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada', playerId: 'p1' })
  await wait(ARM_DELAY_MS + 30)
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  await wait(COLLECT_MS + 30)
  hub.handle(host, { t: 'host', action: { a: 'correct' } })

  while (speech.spoken.length < 3) await wait(5)
  reader.stop()
  await settled(reader)
  assert.deepEqual(speech.spoken, ['One.', '[snickers] Okay.', 'Two.'], 'the line was its own clip, played whole')
})

test('its own Next into a fresh block keeps autoplay on, waits out the introduction, then reads on', async () => {
  const packDir = mkdtempSync(join(tmpdir(), 'pb-reader-seam-'))
  writeFileSync(join(packDir, 'a.txt'), 'A one.\nA: a\n')
  writeFileSync(join(packDir, 'b.txt'), 'B one.\nA: b\n')
  const state = newState()
  const hub = new Hub(state)
  const speech = fakeSpeech()
  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache'), speech })
  hub.setOnChange((s) => reader.onStateChange(s))
  hub.setReader(reader)
  hub.dispatch({
    a: 'setSetlist',
    blocks: [
      { game: 'trivia', options: {}, count: 1, pack: 'a.txt' },
      { game: 'trivia', options: {}, count: 1, pack: 'b.txt' },
    ],
  })
  hub.dispatch({ a: 'closeArrival', arrivalId: state.arrival!.id })
  autoplay(hub, 0.1, 0, 2)
  reader.start()

  while (state.arrival?.kind !== 'introduction') await wait(5)
  assert.equal(state.arrival.blockAt, 1)
  assert.equal(state.autoplay.on, true, 'the seam is not the end of the pack')
  assert.equal(state.readingActive, false, 'the introduction stopped the reader')
  await wait(1_500)
  assert.deepEqual(speech.spoken, ['A one.'], 'nothing is read over the introduction')

  await wait(600)
  assert.equal(state.arrival, undefined)
  while (speech.spoken.length < 2) await wait(5)
  assert.deepEqual(speech.spoken, ['A one.', 'B one.'], 'and the next block resumes by itself')
  while (state.autoplay.on) await wait(5)
  await settled(reader)
})

test('an announcement is spoken only by a performing voice, and never throws', async () => {
  const quiet = rig(PACK)
  quiet.reader.announce('Next: Sketch.')
  await wait(20)
  assert.deepEqual(quiet.speech.spoken, [])

  const packDir = mkdtempSync(join(tmpdir(), 'pb-reader-announce-'))
  const state = newState()
  const hub = new Hub(state)
  const speech = fakeSpeech()
  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache'), speech, perform: true })
  reader.announce('Next: Sketch.')
  await wait(20)
  assert.deepEqual(speech.spoken, ['Next: Sketch.'])

  const broken = new Reader(hub, {
    packDir, cacheDir: join(packDir, '.cache'), perform: true,
    speech: { render: async () => { throw new Error('no voice') }, play: () => { throw new Error('unreachable') } },
  })
  broken.announce('Next: Tank battle.')
  await wait(20)
})

test('the night carries on without rewinding a pack it already read to the end', async () => {
  const packDir = mkdtempSync(join(tmpdir(), 'pb-reader-carry-'))
  writeFileSync(join(packDir, 'a.txt'), 'A one.\nA: a\n')
  writeFileSync(join(packDir, 'b.txt'), 'B one.\nA: b\n')
  const state = newState()
  const hub = new Hub(state)
  const speech = fakeSpeech()
  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache'), speech })
  hub.setOnChange((s) => reader.onStateChange(s))
  hub.setReader(reader)
  const block = (pack: string) => ({ game: 'trivia' as const, options: {}, count: 1, pack })
  hub.dispatch({ a: 'setSetlist', blocks: [block('a.txt'), block('b.txt'), block('a.txt')] })
  autoplay(hub, 0.1, 0, 0.1)
  // Continue is the host's, and under autoplay it begins the night.
  hub.dispatch({ a: 'closeArrival', arrivalId: state.arrival!.id })

  const deadline = Date.now() + 5_000
  while (state.autoplay.on && Date.now() < deadline) await wait(5)
  await settled(reader)
  assert.equal(state.autoplay.on, false, 'a spent pack still ends the night')
  assert.deepEqual(speech.spoken, ['A one.', 'B one.'], 'the third block finds a.txt spent and reads nothing')
})

test('carrying on cuts an introduction announcement that is still rendering or playing', async () => {
  const packDir = mkdtempSync(join(tmpdir(), 'pb-reader-cut-'))
  writeFileSync(join(packDir, 'a.txt'), 'A one.\nA: a\n')
  const state = newState()
  const hub = new Hub(state)
  const played: string[] = []
  let stopped = 0
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const speech: Speech = {
    render: async (_dir, text) => {
      if (text === 'Slow.') await gate
      return { path: `/fake/${text}`, durationMs: 10 }
    },
    play: (path) => {
      played.push(path.replace('/fake/', ''))
      return { done: new Promise<void>(() => {}), started: Promise.resolve(), stop: () => { stopped++ } }
    },
  }
  const reader = new Reader(hub, { packDir, cacheDir: join(packDir, '.cache'), speech, perform: true })
  hub.setOnChange((s) => reader.onStateChange(s))
  hub.setReader(reader)
  hub.dispatch({ a: 'setSetlist', blocks: [{ game: 'trivia', options: {}, count: 1, pack: 'a.txt' }] })
  hub.dispatch({ a: 'closeArrival', arrivalId: state.arrival!.id })

  reader.announce('Playing.')
  await wait(20)
  assert.deepEqual(played, ['Playing.'])
  reader.announce('Slow.')
  await wait(10)
  await reader.select('a.txt')
  reader.carryOn()
  assert.ok(stopped >= 1, 'the announcement that was playing is cut')
  release()
  await wait(20)
  assert.ok(!played.includes('Slow.'), 'and the one still rendering is dropped')
  reader.stop()
  await settled(reader)
})

test('a picture reveal holds on a miss, resumes for the rebound, and pays by where it stood', async () => {
  const { hub, state, reader } = rig('V: 200\nK: reveal\nI: images/camel.svg\nWhat animal is this?\nA: camel\n')
  hub.dispatch({ a: 'setRevealTime', sec: 4 })
  autoplay(hub, 5, 0.3)
  const host = { id: 'h', role: 'host' as const, send: () => {} }
  const [ada, bo] = withPhones(hub, ['ada', 'bo'])
  await reader.select('one.txt')
  reader.start()
  while (!state.round.reveal || state.round.phase !== 'ARMED') await wait(5)
  const first = { ...state.round.reveal }
  assert.equal(first.from, state.round.armedAt)
  assert.equal(first.until - first.from, 4000)

  // Into the second quarter, after the voice has finished.
  await wait(first.from + 1500 - Date.now())
  assert.equal(state.round.image, '/pack-media/images/camel.svg')
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  await wait(COLLECT_MS + 30)
  const heldAt = state.round.order[0].at
  hub.handle(host, { t: 'host', action: { a: 'wrong', neg: 0 } })
  assert.equal(state.round.reveal?.heldAt, heldAt, 'the miss holds the picture where the press stopped it')
  await wait(150)
  assert.equal(state.round.reveal?.heldAt, heldAt, 'and it stays held through the beat')

  while (state.round.phase !== 'ARMED' || state.round.held) await wait(5)
  const resumed = state.round.reveal!
  assert.equal(resumed.heldAt, undefined)
  assert.equal(resumed.until - resumed.from, 4000, 'the same length of reveal')
  assert.equal(state.round.armedAt - resumed.from, heldAt - first.from, 'carried on from where it stood, as the buzzers open')

  // A second into the rebound: 2.5 s of 4 is the third quarter.
  await wait(state.round.armedAt + 1000 - Date.now())
  hub.handle(bo, { t: 'buzz', at: Date.now() })
  await wait(COLLECT_MS + 30)
  hub.handle(host, { t: 'host', action: { a: 'correct' } })
  assert.deepEqual(state.round.award, { name: 'bo', points: 300 })
  assert.equal(state.scores.bo, 300)
  reader.stop()
  await settled(reader)
})
