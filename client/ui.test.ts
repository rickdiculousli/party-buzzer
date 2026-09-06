import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionFeedback, chunks } from './ui.ts'

test('action feedback explains refusals and empty undo without announcing successful edits', () => {
  assert.match(actionFeedback('correct', { status: 'refused', reason: 'no-leader' })!, /Nobody is locked in/)
  assert.equal(actionFeedback('undo', { status: 'unchanged' }), 'Nothing to undo.')
  assert.equal(actionFeedback('setValue', { status: 'unchanged' }), null)
  assert.equal(actionFeedback('correct', { status: 'applied' }), null)
  assert.equal(actionFeedback('loadSetlist', { status: 'failed', message: 'Cannot load.' }), 'Cannot load.')
})

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
