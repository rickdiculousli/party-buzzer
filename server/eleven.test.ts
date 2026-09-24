import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'
import { join } from './align.ts'
import { folds, spans, synthesize, timedFor, type Timed } from './eleven.ts'

/** Every character 10ms long, so a time reads back as a character offset. */
function timed(text: string): Timed {
  return { text, startMs: [...text].map((_, i) => i * 10), endMs: [...text].map((_, i) => i * 10 + 10) }
}

const SCRIPT = '[excited] Right! This physicist, [scoffs] oh come on, won the Nobel Prize. A, Einstein. B, Bohr.'

test('spans pull several phrases out of one take, stepping over tags and ad-libs', () => {
  const t = timed(SCRIPT)
  const [q, a, b, missing] = spans(t, ['This physicist, won the Nobel Prize.', 'A, Einstein.', 'B, Bohr.', 'C, Curie.'])
  assert.deepEqual(q, { startMs: SCRIPT.indexOf('This') * 10, endMs: (SCRIPT.indexOf('Prize.') + 6) * 10 })
  assert.equal(a?.startMs, SCRIPT.indexOf('A, E') * 10)
  assert.equal(b?.endMs, SCRIPT.length * 10)
  assert.equal(missing, undefined)
})

test('each fold fires as the voice begins the clause it reveals, in the performed script', () => {
  const j = join(['This physicist,', 'won the Nobel Prize.'])
  const f = folds(j, timed(SCRIPT))
  assert.deepEqual(
    f.map((x) => [x.kind, j.text.slice(0, x.at), x.ms]),
    [
      ['fragment', 'This physicist, ', SCRIPT.indexOf('This') * 10],
      ['end', j.text, SCRIPT.indexOf('won') * 10],
    ],
  )
})

test('a take renders once and keeps its character times beside it', async () => {
  const dir = mkdtempSync(pathJoin(tmpdir(), 'pb-eleven-'))
  let calls = 0
  const fake = (async () => {
    calls += 1
    const chars = [...'Hi.']
    return new Response(
      JSON.stringify({
        audio_base64: Buffer.from('not really audio').toString('base64'),
        alignment: { characters: chars, character_start_times_seconds: [0, 0.1, 0.2], character_end_times_seconds: [0.1, 0.2, 0.3] },
      }),
    )
  }) as typeof fetch
  const a = await synthesize(dir, 'Hi.', 'voice', 'key', fake)
  const b = await synthesize(dir, 'Hi.', 'voice', 'key', fake)
  assert.equal(calls, 1)
  assert.equal(a.path, b.path)
  assert.ok(existsSync(a.path))
  assert.deepEqual(timedFor(a.path)?.endMs, [100, 200, 300])
})

test("an ad-lib sharing a clause's first word does not take its fold", () => {
  const script = "Won the prize, [aside] and yes, that's the hint, and is best known for relativity."
  const f = folds(join(['Won the prize,', 'and is best known for relativity.']), timed(script))
  assert.equal(f[1].ms, script.indexOf('and is') * 10)
})
