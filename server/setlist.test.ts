import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceSetlist, enterBlock, sanitizeBlocks } from './setlist.ts'
import { newState } from './state.ts'
import type { SetlistBlock, HostAction, State } from '../shared/protocol.ts'

const block = (over: Partial<SetlistBlock> = {}): SetlistBlock => ({
  game: 'trivia',
  options: {},
  count: 2,
  ...over,
})

function stateWithSetlist(blocks: SetlistBlock[]): State {
  const state = newState()
  state.setlist = { blocks, at: 0, done: 0 }
  return state
}

/** Records what the setlist asked for rather than applying it. */
function recorder(): { seen: HostAction[]; apply: (a: HostAction) => void } {
  const seen: HostAction[] = []
  return { seen, apply: (a) => void seen.push(a) }
}

test('a block spends one question per advance, then rolls over', () => {
  const state = stateWithSetlist([block({ count: 2 }), block({ game: 'quizbowl' })])
  const { apply } = recorder()
  advanceSetlist(state, apply)
  assert.deepEqual([state.setlist!.at, state.setlist!.done], [0, 1])
  advanceSetlist(state, apply)
  assert.deepEqual([state.setlist!.at, state.setlist!.done], [1, 0])
})

test('a spent setlist sits at its end rather than wrapping', () => {
  const state = stateWithSetlist([block({ count: 1 })])
  const { seen, apply } = recorder()
  advanceSetlist(state, apply)
  assert.equal(state.setlist!.at, 1)
  const after = seen.length
  advanceSetlist(state, apply)
  assert.equal(state.setlist!.at, 1)
  assert.equal(seen.length, after, 'a spent setlist applies nothing')
})

test('the mode is applied once per block, not once per question', () => {
  const state = stateWithSetlist([block({ count: 3 }), block({ game: 'quizbowl' })])
  const { seen, apply } = recorder()
  advanceSetlist(state, apply) // 1 of 3
  advanceSetlist(state, apply) // 2 of 3
  assert.equal(seen.filter((a) => a.a === 'setMode').length, 0)
  advanceSetlist(state, apply) // rolls into quizbowl
  assert.deepEqual(seen.filter((a) => a.a === 'setMode'), [
    { a: 'setMode', id: 'quizbowl', options: {}, keepScores: true },
  ])
})

test('entering a block keeps the standings across a mode switch', () => {
  const state = stateWithSetlist([block({ game: 'quizbowl', options: { powerAfterFragment: 2 } })])
  const { seen, apply } = recorder()
  enterBlock(state, apply, true)
  assert.deepEqual(seen[0], {
    a: 'setMode',
    id: 'quizbowl',
    options: { powerAfterFragment: 2 },
    keepScores: true,
  })
})

test('the value applies only when the block declares one', () => {
  const withValue = stateWithSetlist([block({ value: 400 })])
  const r1 = recorder()
  enterBlock(withValue, r1.apply, true)
  assert.deepEqual(r1.seen[1], { a: 'setValue', value: 400 })

  const without = stateWithSetlist([block()])
  const r2 = recorder()
  enterBlock(without, r2.apply, true)
  assert.equal(r2.seen.some((a) => a.a === 'setValue'), false)
})

test('a duel block opens a duel every question; a plain block opens none', () => {
  const state = stateWithSetlist([block({ count: 3, duel: 'vote' })])
  const { seen, apply } = recorder()
  advanceSetlist(state, apply)
  advanceSetlist(state, apply)
  assert.deepEqual(
    seen.filter((a) => a.a === 'openDuel'),
    [{ a: 'openDuel', rule: 'vote' }, { a: 'openDuel', rule: 'vote' }],
  )

  const plain = stateWithSetlist([block({ count: 3 })])
  const r = recorder()
  advanceSetlist(plain, r.apply)
  assert.equal(r.seen.length, 0)
})

test('the value is stamped on entry, not re-stamped by every question within the block', () => {
  const state = stateWithSetlist([block({ count: 3, value: 400 })])
  const { seen, apply } = recorder()
  enterBlock(state, apply, true) // the initial, fresh entry — as the setlist's own setup would do
  advanceSetlist(state, apply) // still inside the block: not fresh
  advanceSetlist(state, apply) // still inside the block: not fresh
  assert.equal(
    seen.filter((a) => a.a === 'setValue').length,
    1,
    'a per-question re-stamp would clobber a mid-block tweak or the pack\'s own setValue',
  )
})

test('sanitizeBlocks drops what this build cannot run and clamps the rest', () => {
  const known = (id: string) => id === 'trivia' || id === 'quizbowl'
  const rule = (id: string) => id === 'vote'
  const out = sanitizeBlocks(
    [
      { game: 'trivia', options: { a: 1 }, count: 0 },
      { game: 'chess', options: {}, count: 3 },
      { game: 'quizbowl', options: {}, count: 2, duel: 'thunderdome' },
      { game: 'quizbowl', options: {}, count: 2.6, value: 400, duel: 'vote' },
      { game: 'trivia', options: {}, count: 500 },
      'not a block',
    ],
    known,
    rule,
  )
  assert.deepEqual(out, [
    { game: 'trivia', options: { a: 1 }, count: 1 },
    { game: 'quizbowl', options: {}, count: 3, value: 400, duel: 'vote' },
    { game: 'trivia', options: {}, count: 99 },
  ])
})

test('sanitizeBlocks on junk is an empty setlist, not a throw', () => {
  assert.deepEqual(sanitizeBlocks(null, () => true, () => true), [])
  assert.deepEqual(sanitizeBlocks({ blocks: [] }, () => true, () => true), [])
})
