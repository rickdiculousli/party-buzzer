import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hub } from './hub.ts'
import { newState } from './state.ts'
import { Reader } from './reader.ts'
import type { Speech } from './speech.ts'

/** Speech that plays instantly and records what it was asked to say. */
function fakeSpeech(): Speech & { spoken: string[] } {
  const spoken: string[] = []
  return {
    spoken,
    render: async (_dir, text) => ({ path: `/fake/${text}`, durationMs: 10 }),
    play: (path) => {
      spoken.push(path.replace('/fake/', ''))
      return {
        done: Promise.resolve(),
        pause: () => {},
        resume: () => {},
        stop: () => {},
      }
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

test('selecting a pack renders every fragment and publishes progress', async () => {
  const { state, reader } = rig(PACK)
  await reader.select('one.txt')
  assert.equal(state.reading?.pack, 'one.txt')
  assert.equal(state.reading?.qTotal, 1)
  assert.equal(state.reading?.rendering, undefined, 'rendering clears when done')
})

test('reading a question arms it, speaks each fragment, and pushes them in order', async () => {
  const { state, reader, speech } = rig(PACK)
  await reader.select('one.txt')
  reader.start()
  await reader.settled()

  assert.equal(state.round.value, 300, 'the pack value drives the round')
  assert.deepEqual(speech.spoken, ['First fragment.', 'Second fragment.'])
  assert.deepEqual(state.round.fragments, ['First fragment.', 'Second fragment.'])
})

test('power closes after the configured fragment', async () => {
  const { hub, state, reader } = rig(PACK)
  hub.handle({ id: 'h', role: 'host', send: () => {} }, {
    t: 'host',
    action: { a: 'setGame', id: 'quizbowl', options: { powerAfterFragment: 1 } },
  })
  await reader.select('one.txt')
  reader.start()
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

test('stop halts the loop and clears reading progress', async () => {
  const { state, reader } = rig(PACK)
  await reader.select('one.txt')
  reader.start()
  reader.stop()
  await reader.settled()
  assert.equal(state.reading, undefined)
})
