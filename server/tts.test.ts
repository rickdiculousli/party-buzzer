import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { align, heardBy, spokenBy, ttsBinary } from './tts.ts'

const QUESTION =
  'This Russian composer wrote a ballet about a nutcracker. ' +
  'He also wrote the 1812 Overture, which calls for cannon fire. ' +
  'For ten points, name this composer of Swan Lake.'

test('the reveal cursor never runs ahead of the voice', () => {
  // Pure half — no synthesiser, no machine. These are the numbers the helper
  // produced for the sentence above, kept as data so the cursor logic is
  // testable on a box with no `swiftc`.
  const marks = [
    { loc: 0, len: 4, ms: 0 },
    { loc: 5, len: 7, ms: 243 },
    { loc: 13, len: 8, ms: 615 },
  ]
  assert.equal(spokenBy(marks, -1), -1, 'before the first word nothing has been said')
  assert.equal(heardBy(QUESTION, marks, -1), '', 'and nothing may go on the board')
  assert.equal(heardBy(QUESTION, marks, 0), 'This')
  assert.equal(heardBy(QUESTION, marks, 242), 'This', 'a word is not revealed until it starts')
  assert.equal(heardBy(QUESTION, marks, 243), 'This Russian')
  assert.equal(heardBy(QUESTION, marks, 99999), 'This Russian composer')
})

test('marks land on real words, in order, inside the clip', { concurrency: 1 }, async (t) => {
  const bin = await ttsBinary(join(import.meta.dirname, 'tts'))
  if (!bin) return t.skip('no swiftc / no helper source')

  const dir = mkdtempSync(join(tmpdir(), 'tts-'))
  try {
    const got = await align(bin, QUESTION, join(dir, 'q.caf'))
    assert.ok(got, 'the helper produced audio and marks')

    assert.ok(got.marks.length > 20, `one mark per word, got ${got.marks.length}`)
    let prev = -1
    for (const m of got.marks) {
      assert.ok(m.ms >= prev, `marks must not go backwards (${m.ms} after ${prev})`)
      assert.ok(m.ms <= got.durationMs, `a mark past the end of the clip (${m.ms} > ${got.durationMs})`)
      prev = m.ms

      // The offset must point at a whole word of the SOURCE text — this is what
      // breaks if byteSampleOffset ever changes units, or if a marker starts
      // reporting the normalised text ("eighteen twelve") instead of "1812".
      const word = QUESTION.slice(m.loc, m.loc + m.len)
      assert.ok(/^\S+$/.test(word), `mark ${m.loc}+${m.len} is not a word: ${JSON.stringify(word)}`)
      assert.ok(m.loc === 0 || QUESTION[m.loc - 1] === ' ', `mark ${m.loc} starts mid-word`)
    }

    assert.equal(heardBy(QUESTION, got.marks, 0), 'This', 'the clip opens on the first word')
    assert.ok(
      heardBy(QUESTION, got.marks, got.durationMs).endsWith('Lake.'),
      'by the end of the clip the whole question has been heard',
    )
    assert.ok(
      !heardBy(QUESTION, got.marks, 3000).includes('cannon'),
      'three seconds in, the second sentence has not leaked',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
