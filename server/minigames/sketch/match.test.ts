import test from 'node:test'
import assert from 'node:assert/strict'
import { blanks, distance, isClose, isCorrect, letterIndexes, normalize } from './match.ts'
import { parseSketchWords } from './words.ts'

test('case, accents, spaces and punctuation never decide a guess', () => {
  assert.equal(normalize('  Ice-Cream! '), 'icecream')
  assert.equal(normalize('Café'), 'cafe')
  assert.ok(isCorrect('ice cream', 'Ice-cream'))
  assert.ok(isCorrect('ICECREAM', 'ice cream'))
  assert.ok(isCorrect('cafe', 'Café'))
  assert.ok(!isCorrect('', 'cat'))
  assert.ok(!isCorrect('ice', 'ice cream'))
})

test('close is one edit away, and only on words of four or more characters', () => {
  assert.equal(distance('kitten', 'sitting'), 3)
  assert.ok(isClose('elephnt', 'elephant'))
  assert.ok(isClose('bats', 'cats'))
  assert.ok(!isClose('elephant', 'elephant'))
  assert.ok(!isClose('elphnt', 'elephant'))
  assert.ok(!isClose('bat', 'cat'))
})

test('blanks hide letters and digits and keep spaces and punctuation', () => {
  assert.deepEqual(letterIndexes('T-rex'), [0, 2, 3, 4])
  assert.equal(blanks('ice cream', []), '___ _____')
  assert.equal(blanks('T-rex', [0]), 'T-___')
})

test('the word list skips blanks, comments and repeats', () => {
  assert.deepEqual(parseSketchWords('# food\n\ncat\n Cat \nice  cream\n!!!\n'), ['cat', 'ice cream'])
})
