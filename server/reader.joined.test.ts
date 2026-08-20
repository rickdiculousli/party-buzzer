/**
 * The reader with an aligner: one clip per question, revealed a clause at a
 * time. Everything here is fake except the reader and the hub — the point is
 * what reaches State and when, not whether a Mac can talk.
 */
import test from 'node:test'
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

function rig(align?: Aligner) {
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
  })
  hub.setOnChange((s) => reader.onStateChange(s))
  return { hub, state, reader, plays }
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms))
async function reachArm(state: ReturnType<typeof newState>) {
  await settle(ARM_DELAY_MS + 30)
  return state
}

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
