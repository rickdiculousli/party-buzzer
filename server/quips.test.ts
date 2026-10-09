import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePools, Picker, type Line } from './quips.ts'

test('pools parse by heading, with sincere lines marked and comments ignored', () => {
  const { pools, plain } = parsePools(`# a comment
stray line
# correct
[sarcastic] Wow.
★ [impressed] Good.
# wrong
* [sighs] Close.
# plain wrong
No.
# toString
not a pool`)
  assert.deepEqual(pools.correct, [
    { text: '[sarcastic] Wow.', sincere: false },
    { text: '[impressed] Good.', sincere: true },
  ])
  assert.deepEqual(pools.wrong, [{ text: '[sighs] Close.', sincere: true }])
  assert.deepEqual(pools.nobody, [])
  assert.deepEqual(plain.wrong, [{ text: 'No.', sincere: false }])
  assert.deepEqual(plain.correct, [])
})

const line = (text: string): Line => ({ text, sincere: false })

test('a quip never repeats the line just said', () => {
  const quips = [line('a'), line('b')]
  const picker = new Picker(() => 0) // always under the odds, always the first open line
  assert.equal(picker.pick('wrong', quips)?.text, 'a')
  assert.equal(picker.pick('wrong', quips)?.text, 'b', 'not the line just said')
  assert.equal(picker.pick('wrong', quips)?.text, 'a')
})

test('a verdict the quip skips gets the next plain line, in rotation', () => {
  const picker = new Picker(() => 0.9) // always over the odds
  const plain = [line('Correct.'), line('Right.'), line('Yes.')]
  const said = [1, 2, 3, 4].map(() => picker.pick('correct', [line('quip')], plain)?.text)
  assert.deepEqual(said, ['Correct.', 'Right.', 'Yes.', 'Correct.'])
})

test('about half of verdicts quip', () => {
  assert.equal(new Picker(() => 0.49).pick('correct', [line('quip')], [line('plain')])?.text, 'quip')
  assert.equal(new Picker(() => 0.5).pick('correct', [line('quip')], [line('plain')])?.text, 'plain')
})

test('with no plain lines a skipped verdict stays silent', () => {
  assert.equal(new Picker(() => 0.9).pick('nobody', [line('quip')]), undefined)
})
