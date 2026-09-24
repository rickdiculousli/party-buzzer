import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePools, Picker, type Line } from './quips.ts'

test('pools parse by heading, with sincere lines marked and comments ignored', () => {
  const pools = parsePools(`# a comment
stray line
# correct
[sarcastic] Wow.
★ [impressed] Good.
# wrong
* [sighs] Close.
# toString
not a pool`)
  assert.deepEqual(pools.correct, [
    { text: '[sarcastic] Wow.', sincere: false },
    { text: '[impressed] Good.', sincere: true },
  ])
  assert.deepEqual(pools.wrong, [{ text: '[sighs] Close.', sincere: true }])
  assert.deepEqual(pools.nobody, [])
})

test('the picker never quips twice running and never repeats its last line', () => {
  const lines: Line[] = [
    { text: 'a', sincere: false },
    { text: 'b', sincere: false },
  ]
  const picker = new Picker(() => 0) // always under the odds, always the first open line
  assert.equal(picker.pick('wrong', lines), 0)
  assert.equal(picker.pick('wrong', lines), undefined, 'a quip is followed by a silence')
  assert.equal(picker.pick('wrong', lines), 1, 'and the next is not the line just said')
  picker.forced()
  assert.equal(picker.pick('correct', lines), undefined, 'an R: line counts as the last quip')
})

test('the picker lets most verdicts pass', () => {
  const lines: Line[] = [{ text: 'a', sincere: false }]
  assert.equal(new Picker(() => 0.5).pick('correct', lines), undefined)
})
