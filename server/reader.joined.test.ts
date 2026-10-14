/**
 * The reader with an aligner: one clip per question, revealed a clause at a
 * time. Everything here is fake except the reader and the hub — the point is
 * what reaches State and when, not whether a Mac can talk.
 */
import { test as nodeTest, mock } from 'node:test'
import type { TestContext, TestOptions } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { Hub } from './hub.ts'
import { newState } from './state.ts'
import { Reader, type Aligner } from './reader.ts'
import { join } from './align.ts'
import type { Playback, Speech } from './speech.ts'
import { ARM_DELAY_MS } from '../shared/protocol.ts'

const FRAGMENTS = ['First one, with a clause.', 'Second one.']
const PACK = `V: 300\n${FRAGMENTS.join(' / ')}\nA: gold\n`

/** A clip the test holds open, so a pause or a buzz can land mid-question. */
function heldSpeech() {
  const plays: { path: string; fromMs: number; end: () => void }[] = []
  const speech: Speech = {
    render: async (_dir, text) => ({ path: `/fake/${text}`, durationMs: 4000 }),
    play: (path, fromMs = 0): Playback => {
      let end = () => {}
      const done = new Promise<void>((r) => (end = r))
      plays.push({ path, fromMs, end })
      return { done, started: Promise.resolve(), stop: () => end() }
    },
  }
  return { speech, plays }
}

/**
 * Folds where a real aligner would put them for the pack above: after the
 * comma, and at the second fragment. Times are far enough apart that the test
 * can step between them.
 */
function foldsFor(): Aligner {
  return async (j) => {
    const comma = j.text.indexOf(',') + 2
    return [
      { at: comma, ms: 100, kind: 'clause', sure: true },
      { at: j.fragmentAt[1], ms: 200, kind: 'fragment', sure: true },
      { at: j.text.length, ms: 300, kind: 'end', sure: true },
    ]
  }
}

function rig(align?: Aligner, nextCardMs?: number) {
  const packDir = mkdtempSync(pathJoin(tmpdir(), 'pb-joined-'))
  writeFileSync(pathJoin(packDir, 'one.txt'), PACK)
  const state = newState()
  const hub = new Hub(state)
  const { speech, plays } = heldSpeech()
  const reader = new Reader(hub, {
    packDir,
    cacheDir: pathJoin(packDir, '.cache'),
    speech,
    align,
    nextCardMs,
  })
  hub.setOnChange((s) => reader.onStateChange(s))
  return { hub, state, reader, plays }
}

/**
 * Every test runs on a mock clock: `settle(ms)` advances timers and
 * `Date.now()` together in 5 ms steps, yielding to the event loop between them
 * so promise chains keep pace. A busy machine cannot move a fold past a check.
 */
const STEP_MS = 5

type Body = (t: TestContext) => void | Promise<void>
function test(name: string, fn: Body): void
function test(name: string, opts: TestOptions, fn: Body): void
function test(name: string, a: TestOptions | Body, b?: Body) {
  const opts = typeof a === 'function' ? {} : a
  const fn = (typeof a === 'function' ? a : b) as Body
  nodeTest(name, opts, async (t) => {
    // A test that timed out never reached its `finally`; don't fail the rest.
    mock.timers.reset()
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })
    try {
      await fn(t)
    } finally {
      mock.timers.reset()
    }
  })
}

async function settle(ms = 30) {
  // Small steps, so work that waits on a timer and then on a promise keeps pace.
  for (let left = ms; left > 0; left -= STEP_MS) {
    mock.timers.tick(Math.min(STEP_MS, left))
    await new Promise((r) => setImmediate(r))
  }
}

/** Drives the clock until the reader's loop has finished. */
async function settled(reader: Reader) {
  let done = false
  const finished = reader.settled().then(() => { done = true })
  while (!done) await settle(STEP_MS)
  await finished
}

async function reachArm(state: ReturnType<typeof newState>) {
  await settle(ARM_DELAY_MS + 30)
  return state
}

test('aligned playback reports completed fragments once and the mode owns their power effect', { timeout: 3000 }, async (t) => {
  const { hub, state, reader, plays } = rig(foldsFor())
  t.after(() => reader.stop())
  hub.dispatch({ a: 'setMode', id: 'quizbowl', options: { powerAfterFragment: 1 } })
  const completed: number[] = []
  const report = hub.fragmentEnded.bind(hub)
  t.mock.method(hub, 'fragmentEnded', (id: string, count: number) => {
    completed.push(count)
    report(id, count)
  })
  const host = { id: 'h', role: 'host' as const, send() {} }
  await reader.select('one.txt')
  reader.start()
  while (plays.length < 1) await settle(5)
  assert.equal(hub.viewFor(host).game.status?.label, 'Power open', 'a partial fragment earns no completion')
  while (completed.length < 1) await settle(5)
  assert.equal(hub.viewFor(host).game.status?.label, 'Power ended')
  const cutoff = structuredClone(state.game.moduleState)
  while (completed.length < 2) await settle(5)
  plays[0].end()
  await settle(10)
  assert.deepEqual(completed, [1, 2], 'the final clip completion does not duplicate its last fold')
  assert.deepEqual(state.game.moduleState, cutoff, 'later completions cannot shift power')
})

test('the whole question is one utterance, with no separator in it', async () => {
  const { reader, plays } = rig(foldsFor())
  await reader.select('one.txt')
  reader.start()
  await settle(ARM_DELAY_MS + 40)

  assert.equal(plays.length, 1, 'one clip for the question, not one per fragment')
  const spoken = plays[0].path.replace('/fake/', '')
  assert.equal(spoken, join(FRAGMENTS).text)
  assert.ok(!spoken.includes(' / '), 'the fragment separator never reaches the voice')
  assert.equal(plays[0].fromMs, 0)
  reader.stop()
})

test('a clause goes up as it begins, and never crosses into the next fragment', async () => {
  const { state, reader } = rig(foldsFor())
  await reader.select('one.txt')
  reader.start()
  await reachArm(state)

  // The opening clause is on the board as the reader starts saying it, not
  // after — that is the whole point of folding on a clause's first word. What
  // must never be up is a fragment the voice has not reached at all.
  const early = state.round.fragments ?? []
  assert.equal(early.length, 1, 'the fragment in progress, and no other')
  assert.ok(
    FRAGMENTS[0].startsWith(early[0]),
    `what is shown is a prefix of the first fragment, got ${JSON.stringify(early[0])}`,
  )

  await settle(400)
  const shown = state.round.fragments ?? []
  assert.equal(shown.length, 2, 'two fragment entries, one per fragment')
  assert.equal(shown[0], FRAGMENTS[0], 'the first fragment completed')
  assert.ok(
    FRAGMENTS[1].startsWith(shown[1]),
    `the second entry is a prefix of its fragment, got ${JSON.stringify(shown[1])}`,
  )
  reader.stop()
})

test('the first entry grows rather than the board gaining a third fragment', async () => {
  const { state, reader } = rig(async (j) => [
    // Only the clause fold, so the first fragment is revealed in two goes and
    // the second is never reached.
    { at: j.text.indexOf(',') + 2, ms: 100, kind: 'clause', sure: true },
  ])
  await reader.select('one.txt')
  reader.start()
  await reachArm(state)
  await settle(400)

  const shown = state.round.fragments ?? []
  assert.equal(shown.length, 1, 'a clause inside a fragment must not add an entry')
  assert.equal(shown[0], 'First one,', 'only as far as the voice has got')
  assert.ok(
    FRAGMENTS[0].startsWith(shown[0]),
    'and what is shown is a prefix of the fragment, never text from the next one',
  )
  reader.stop()
})

test('a question with no folds found says everything and shows it at the end', async () => {
  const { state, reader, plays } = rig(async () => [])
  await reader.select('one.txt')
  reader.start()
  await reachArm(state)
  await settle(200)

  assert.equal(state.round.fragments ?? undefined, undefined, 'nothing early')
  plays[0].end() // the clip runs out
  await settle(60)
  assert.deepEqual(state.round.fragments, FRAGMENTS, 'all of it, once it has all been said')
  reader.stop()
})

test('an interruption picks the clause up again rather than the question', async () => {
  const { state, reader, plays } = rig(foldsFor())
  await reader.select('one.txt')
  reader.start()
  await reachArm(state)
  await settle(250) // past the clause fold and the fragment fold, short of the end

  reader.pause()
  await settle(30)
  assert.equal(plays.length, 1, 'still the one clip so far')

  reader.resume()
  await settle(60)
  assert.equal(plays.length, 2, 'playback restarted')
  assert.equal(
    plays[1].fromMs,
    200,
    'resumed at the last fold — where the board had got to, not the top of the question',
  )
  reader.stop()
})

test('a paid voice prices each pack at the characters it has not rendered yet', () => {
  const packDir = mkdtempSync(pathJoin(tmpdir(), 'pb-price-'))
  writeFileSync(pathJoin(packDir, 'one.txt'), PACK)
  const state = newState()
  const hub = new Hub(state, { packDir })
  const paid = new Set<string>()
  const { speech } = heldSpeech()
  const reader = new Reader(hub, {
    packDir,
    cacheDir: pathJoin(packDir, '.cache'),
    speech: { ...speech, cached: (_dir, text) => paid.has(text) },
    align: foldsFor(),
  })
  reader.priceUp()
  assert.deepEqual(state.packCost, { 'one.txt': join(FRAGMENTS).text.length })
  paid.add(join(FRAGMENTS).text)
  reader.priceUp()
  assert.deepEqual(state.packCost, { 'one.txt': 0 })
})

test('a performing voice speaks the S: script and folds it against the fragments', { timeout: 3000 }, async () => {
  const packDir = mkdtempSync(pathJoin(tmpdir(), 'pb-script-'))
  const script = '[curious] First one, with a clause. [excited] and get this — Second one!'
  writeFileSync(pathJoin(packDir, 'one.txt'), `V: 300\n${FRAGMENTS.join(' / ')}\nS: ${script}\nA: gold\n`)
  const state = newState()
  const hub = new Hub(state, { packDir })
  const { speech, plays } = heldSpeech()
  const aligned: string[] = []
  const reader = new Reader(hub, {
    packDir,
    cacheDir: pathJoin(packDir, '.cache'),
    speech,
    perform: true,
    align: async (j, clip) => {
      aligned.push(`${j.text} <- ${clip.path}`)
      return foldsFor()(j, clip)
    },
  })
  hub.setOnChange((s) => reader.onStateChange(s))
  await reader.select('one.txt')
  reader.start()
  while (plays.length < 1) await settle(5)
  reader.stop()
  assert.deepEqual(aligned, [`${join(FRAGMENTS).text} <- /fake/${script}`])
  assert.equal(plays[0]?.path, `/fake/${script}`)
})

test('a performing voice prices in R: lines and the quip pools', () => {
  const packDir = mkdtempSync(pathJoin(tmpdir(), 'pb-quip-price-'))
  writeFileSync(pathJoin(packDir, 'one.txt'), `V: 300\n${FRAGMENTS.join(' / ')}\nR: Nice.\nA: gold\n`)
  const state = newState()
  const hub = new Hub(state, { packDir })
  const { speech } = heldSpeech()
  const reader = new Reader(hub, {
    packDir,
    cacheDir: pathJoin(packDir, '.cache'),
    speech: { ...speech, cached: () => false },
    align: foldsFor(),
    perform: true,
    quips: { pools: { correct: [{ text: 'Wow.', sincere: false }], wrong: [], nobody: [] } },
  })
  reader.priceUp()
  assert.equal(state.packCost['one.txt'], join(FRAGMENTS).text.length + 'Nice.'.length + 'Wow.'.length)
})

const introBlocks = [{ game: 'trivia', options: {}, count: 2, pack: 'one.txt' }]

test('Read during an introduction never activates the reader, and Continue does not start it', { timeout: 3000 }, async () => {
  const { hub, state, reader, plays } = rig(foldsFor())
  const host = { id: 'h', role: 'host' as const, send() {} }
  hub.dispatch({ a: 'setSetlist', blocks: introBlocks })
  assert.equal(state.arrival?.kind, 'introduction')

  hub.handle(host, { t: 'act', act: 'read' })
  assert.equal(state.readingActive, false, 'not activated')
  assert.equal(state.reading, undefined, 'no progress published')

  hub.dispatch({ a: 'closeArrival', arrivalId: state.arrival!.id })
  await settled(reader)
  assert.equal(state.readingActive, false, 'Read was refused, not queued')
  assert.equal(state.round.phase, 'IDLE')
  assert.equal(plays.length, 0)
})

test('an introduction arriving during the card dwell refuses the arm and the loop ends rather than waiting', { timeout: 3000 }, async () => {
  // The hub is not wired to stop this reader, so the dwell runs out into the
  // introduction and the arm itself is refused.
  const { hub, state, reader, plays } = rig(foldsFor(), 40)
  await reader.select('one.txt')
  reader.start()
  // The pack's value lands immediately before the card dwell.
  while (state.round.value !== 300) await settle(1)
  hub.dispatch({ a: 'setSetlist', blocks: introBlocks })
  assert.equal(state.arrival?.kind, 'introduction')

  await settled(reader)
  assert.equal(state.round.phase, 'IDLE', 'never armed')
  assert.equal(state.readingActive, false, 'the session ended')
  assert.equal(state.arrival?.kind, 'introduction', 'and left the introduction up')
  assert.equal(plays.length, 0)
})
