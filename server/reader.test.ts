import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hub } from './hub.ts'
import { newState } from './state.ts'
import { Reader } from './reader.ts'
import type { Speech } from './speech.ts'
import { ARM_DELAY_MS, COLLECT_MS } from '../shared/protocol.ts'

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
  return { hub, state, reader, speech }
}

const PACK = 'V: 300\nFirst fragment. / Second fragment.\nA: gold\n'

// The reader's `stillMine` falls back to `armedAt` before the first fragment,
// which is only safe while a rebound cannot re-arm inside the collection
// window. See the note beside the constants in shared/protocol.ts.
test('the collection window outlasts the arm delay', () => {
  assert.ok(COLLECT_MS > ARM_DELAY_MS, `${COLLECT_MS} must exceed ${ARM_DELAY_MS}`)
})

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

  await reader.select('one.txt') // returns on the first question, not the last
  assert.equal(state.reading?.qTotal, 2)
  assert.deepEqual(state.reading?.rendering, { done: 1, total: 2 }, 'the rest is still coming')

  reader.start()
  while (!state.round.fragments?.length) await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(state.round.fragments, ['Alpha.'], 'question one plays against a half-made pack')

  // Question two must not arm onto a clip that does not exist yet.
  hub.handle({ id: 'h', role: 'host', send: () => {} }, { t: 'host', action: { a: 'next' } })
  await new Promise((r) => setTimeout(r, ARM_DELAY_MS + 40))
  assert.equal(state.round.fragments?.length ?? 0, 0, 'nothing spoken while it is unrendered')

  held.forEach((r) => r())
  while (!state.round.fragments?.length) await new Promise((r) => setTimeout(r, 5))
  assert.deepEqual(state.round.fragments, ['Beta.'], 'and it reads once the audio lands')
  reader.stop()
  await reader.settled()
})

test('reading a question arms it, speaks each fragment, and pushes them in order', async () => {
  const { state, reader, speech } = rig(PACK)
  await reader.select('one.txt')
  reader.start()
  // Nothing judges this question — real quizbowl leaves it ARMED so a late
  // buzz still lands. fakeSpeech is instant, but arming has a countdown, so
  // poll for both fragments rather than guess a delay.
  while (speech.spoken.length < 2) await new Promise((r) => setTimeout(r, 5))
  reader.stop()
  await reader.settled()

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
    await new Promise((r) => setTimeout(r, 5))
  }
  reader.stop()
  await reader.settled()

  const ms = state.game.moduleState as { powerEndsAt?: number }
  assert.ok(ms.powerEndsAt, 'powerEnds fired at the fragment boundary')
})

test('an undo mid-question aborts the reader instead of pushing onto a dead round', async () => {
  const { hub, state, reader, speech } = rig(
    'One. / Two. / Three.\nA: a\n',
  )
  await reader.select('one.txt')
  reader.start()
  // Re-arm under the reader's feet: a new arm stamp means a different round.
  await new Promise((r) => setTimeout(r, 5))
  hub.handle({ id: 'h', role: 'host', send: () => {} }, { t: 'host', action: { a: 'arm' } })
  await reader.settled()

  assert.ok(
    speech.spoken.length < 3,
    `expected the reader to abort, but it spoke all of ${speech.spoken.length}`,
  )
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
  while (speech.spoken.length < 1) await new Promise((r) => setTimeout(r, 5))

  reader.pause()
  await new Promise((r) => setTimeout(r, 20))
  assert.deepEqual(speech.spoken, ['First fragment.'], 'paused, not advanced')

  reader.resume()
  while (speech.spoken.length < 2) await new Promise((r) => setTimeout(r, 5))
  reader.stop()
  await reader.settled()
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
  while (speech.spoken.length < 1) await new Promise((r) => setTimeout(r, 5))

  const host = { id: 'h', role: 'host' as const, send: () => {} }
  hub.handle({ id: 'p', role: 'player', playerId: 'p1', send: () => {} }, { t: 'hello', role: 'player', name: 'Ada', playerId: 'p1' })
  await new Promise((r) => setTimeout(r, ARM_DELAY_MS + 20))
  hub.handle({ id: 'p', role: 'player', playerId: 'p1', send: () => {} }, { t: 'buzz', at: Date.now() })
  assert.equal(stopped, 1, 'the voice is killed on the buzz itself, not a tick later')

  // Judged correct: the second fragment must never be spoken.
  await new Promise((r) => setTimeout(r, 40))
  hub.handle(host, { t: 'host', action: { a: 'correct' } })
  await new Promise((r) => setTimeout(r, 40))
  assert.deepEqual(speech.spoken, ['First fragment.'], 'the clue stops where the buzz did')

  reader.stop()
  await reader.settled()
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
  while (speech.spoken.length < 1) await new Promise((r) => setTimeout(r, 5))

  const host = { id: 'h', role: 'host' as const, send: () => {} }
  const ada = { id: 'p', role: 'player' as const, playerId: 'p1', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada', playerId: 'p1' })
  await new Promise((r) => setTimeout(r, ARM_DELAY_MS + 20))
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  await new Promise((r) => setTimeout(r, COLLECT_MS + 30))
  hub.handle(host, { t: 'host', action: { a: 'wrong', neg: 0 } })

  while (speech.spoken.length < 2) await new Promise((r) => setTimeout(r, 5))
  reader.stop()
  await reader.settled()
  assert.equal(speech.spoken[1], 'First fragment.', 'the cut fragment, from its start')
})

/** Turn autoplay on with dwells short enough to test against. */
function autoplay(hub: Hub, nextSec: number, reboundSec: number): void {
  hub.handle({ id: 'h', role: 'host', send: () => {} }, {
    t: 'host',
    action: { a: 'setAutoplay', on: true, nextSec, reboundSec },
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
  await new Promise((r) => setTimeout(r, ARM_DELAY_MS + 30))
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  await new Promise((r) => setTimeout(r, COLLECT_MS + 30))
  hub.handle(host, { t: 'host', action: { a: 'correct' } })
  assert.ok(state.round.award, 'the payoff is on the wall')

  // Nobody presses N. The reader does.
  while (speech.spoken.length < 2) await new Promise((r) => setTimeout(r, 5))
  reader.stop()
  await reader.settled()
  assert.equal(speech.spoken[1], 'Two.', 'it moved on by itself')
})

test('autoplay passes a question nobody buzzed rather than waiting forever', async () => {
  const { hub, reader, speech } = rig('One.\nA: gold\n\nTwo.\nA: silver\n')
  autoplay(hub, 0.1, 0)
  await reader.select('one.txt')
  reader.start()
  while (speech.spoken.length < 2) await new Promise((r) => setTimeout(r, 5))
  reader.stop()
  await reader.settled()
  assert.deepEqual(speech.spoken, ['One.', 'Two.'], 'dead air passed on its own')
})

test('with autoplay off, dead air waits for the host and nothing advances', async () => {
  const { reader, speech } = rig('One.\nA: gold\n\nTwo.\nA: silver\n')
  await reader.select('one.txt')
  reader.start()
  await new Promise((r) => setTimeout(r, ARM_DELAY_MS + 200))
  assert.deepEqual(speech.spoken, ['One.'], 'still holding on the host')
  reader.stop()
  await reader.settled()
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
  while (speech.spoken.length < 1) await new Promise((r) => setTimeout(r, 5))

  const host = { id: 'h', role: 'host' as const, send: () => {} }
  const ada = { id: 'p', role: 'player' as const, playerId: 'p1', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada', playerId: 'p1' })
  await new Promise((r) => setTimeout(r, ARM_DELAY_MS + 20))
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  await new Promise((r) => setTimeout(r, COLLECT_MS + 30))
  hub.handle(host, { t: 'host', action: { a: 'wrong', neg: 0 } })

  await new Promise((r) => setTimeout(r, 150))
  assert.equal(speech.spoken.length, 1, 'the beat is still running')
  while (speech.spoken.length < 2) await new Promise((r) => setTimeout(r, 5))
  reader.stop()
  await reader.settled()
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
  while (speech.spoken.length < 1) await new Promise((r) => setTimeout(r, 5))

  const host = { id: 'h', role: 'host' as const, send: () => {} }
  const ada = { id: 'p', role: 'player' as const, playerId: 'p1', send: () => {} }
  hub.handle(ada, { t: 'hello', role: 'player', name: 'Ada', playerId: 'p1' })
  await new Promise((r) => setTimeout(r, ARM_DELAY_MS + 20))
  hub.handle(ada, { t: 'buzz', at: Date.now() })
  await new Promise((r) => setTimeout(r, COLLECT_MS + 30))
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

  while (hub.state.round.phase !== 'ARMED') await new Promise((r) => setTimeout(r, 5))
  assert.equal(state.round.held, undefined, 'and then the buzzers are open again')

  // The clue picks up where the buzz cut it rather than the reader moving on.
  while (speech.spoken.length < 2) await new Promise((r) => setTimeout(r, 5))
  assert.equal(speech.spoken[1], 'First fragment.', 'the cut fragment resumes')
  assert.deepEqual(state.round.award, { name: 'Ada', points: -10, penalty: true }, 'still up')
  assert.equal(state.round.answer, undefined, 'still not revealed')
  reader.stop()
  await reader.settled()
})

test('the pack running out turns autoplay off, and leaves the dwells alone', async () => {
  const { hub, state, reader } = rig('Only one.\nA: gold\n')
  autoplay(hub, 0.1, 3)
  await reader.select('one.txt')
  reader.start()
  await reader.settled()

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
  autoplay(hub, 0.1, 0)
  reader.start()
  await reader.settled()

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
  autoplay(hub, 0.1, 0)
  reader.start()
  await reader.settled()

  assert.deepEqual(speech.spoken, ['One.'], 'it stopped at the block it cannot read')
})

test('Read after a pack is spent starts it again', async () => {
  const { hub, reader, speech } = rig('Only one.\nA: gold\n')
  autoplay(hub, 0.1, 0)
  await reader.select('one.txt')
  reader.start()
  await reader.settled()
  assert.deepEqual(speech.spoken, ['Only one.'])

  reader.start()
  while (speech.spoken.length < 2) await new Promise((r) => setTimeout(r, 5))
  reader.stop()
  await reader.settled()
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
  autoplay(hub, 0.1, 0)

  reader.start()
  await reader.settled()
  assert.deepEqual(speech.spoken, ['A one.', 'B one.'])

  // The run ended on b; a is spent too, and the setlist starts on it. Autoplay
  // switched itself off when the reading ran out, so a second night turns it
  // back on the same way the host would.
  hub.handle({ id: 'h', role: 'host', send: () => {} }, { t: 'host', action: { a: 'setlistJump', at: 0 } })
  autoplay(hub, 0.1, 0)
  reader.start()
  await reader.settled()
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
  await reader.settled()
  assert.equal(state.reading, undefined)
})
