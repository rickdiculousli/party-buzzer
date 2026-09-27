import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionFeedback, chunks, setlistPosition } from './ui.ts'

test('board setlist position names the mode, block, and question', () => {
  const state = {
    games: [
      { id: 'trivia', name: 'Trivia', options: [] },
      { id: 'quizbowl', name: 'Quizbowl-lite', options: [] },
    ],
    setlist: {
      blocks: [
        { game: 'trivia', options: {}, count: 3 },
        { game: 'quizbowl', options: {}, count: 4 },
        { game: 'ink', options: {}, count: 1 },
      ],
      at: 1,
      done: 2,
    },
  }
  assert.equal(setlistPosition(state), 'Quizbowl-lite · Block 2/3 · Question 3/4')
  state.setlist.at = 2
  state.setlist.done = 0
  assert.equal(setlistPosition(state), 'Phantom Ink · Block 3/3')
  state.setlist.at = 3
  assert.equal(setlistPosition(state), null)
})

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
