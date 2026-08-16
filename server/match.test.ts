import test from 'node:test'
import assert from 'node:assert/strict'
import { matchAnswer } from './match.ts'

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
