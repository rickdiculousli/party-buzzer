import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchAnswer } from './match.ts'
import { parsePack } from '../shared/pack.ts'

test('an exact answer matches, any variant does', () => {
  assert.ok(matchAnswer('Vermont', ['Vermont']))
  assert.ok(matchAnswer('VT', ['Vermont', 'VT', 'the Green Mountain State']))
  assert.ok(matchAnswer('green mountain state', ['Vermont', 'VT', 'the Green Mountain State']))
})

test('case, punctuation and articles are ignored', () => {
  assert.ok(matchAnswer('THE Green-Mountain State!', ['the Green Mountain State']))
})

test('ordinary STT mangling within one or two edits still matches', () => {
  assert.ok(matchAnswer('vermant', ['Vermont']))
  assert.ok(matchAnswer('the green mountin state', ['the Green Mountain State']))
  assert.ok(matchAnswer('pair us', ['Paris']))
})

test('extra spoken words are ignored', () => {
  assert.ok(matchAnswer('uh, the green mountain state?', ['the Green Mountain State']))
})

test('a different answer is rejected', () => {
  assert.equal(matchAnswer('New Hampshire', ['Vermont']), false)
  assert.equal(matchAnswer('their mound', ['Vermont']), false)
  assert.equal(matchAnswer('green mountain', ['the Green Mountain State']), false)
})

test('an empty transcript never matches', () => {
  assert.equal(matchAnswer('', ['Vermont']), false)
  assert.equal(matchAnswer('the a an', ['Vermont']), false)
})

/**
 * `npm run walk-read` speaks three answers aloud and asserts three scores. If
 * one of them stops landing on the side the walkthrough expects, the run turns
 * into a minute of audio that ends on the wrong numbers with nothing saying
 * why — so the pack and the words the script says are checked together here.
 */
test('walk-read: the pack takes the answers the walkthrough speaks, and refuses the miss', () => {
  const { questions, errors } = parsePack(
    readFileSync(join(import.meta.dirname, '..', 'packs', 'walk-c.txt'), 'utf8'),
  )
  assert.deepEqual(errors, [])
  assert.equal(questions.length, 3)
  // Question two has to be long enough for the miss and the rebound to sit two
  // sentences apart; the script's buzz offset is measured against these.
  assert.ok(questions[1].fragments.length >= 4)

  assert.ok(matchAnswer('the Pacific Ocean', questions[0].answers))
  assert.ok(matchAnswer('Marie Curie', questions[1].answers))
  assert.ok(!matchAnswer('Rosalind Franklin', questions[1].answers))
})
