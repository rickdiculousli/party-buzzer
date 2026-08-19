import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunks } from './ui.ts'

test('chunks: mostly pairs, a single every third beat', () => {
  assert.deepEqual(chunks('the capital of france is paris'), [
    'the',
    'capital of',
    'france is',
    'paris',
  ])
  assert.deepEqual(chunks('paris'), ['paris'])
  assert.deepEqual(chunks(''), [])
  assert.deepEqual(chunks('  spaced   out '), ['spaced', 'out'])
})
