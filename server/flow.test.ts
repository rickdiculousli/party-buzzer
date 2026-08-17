import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceFlow, enterBlock, sanitizeBlocks } from './flow.ts'
import { newState } from './state.ts'
import type { FlowBlock, HostAction, State } from '../shared/protocol.ts'

const block = (over: Partial<FlowBlock> = {}): FlowBlock => ({
  game: 'trivia',
  options: {},
  count: 2,
  ...over,
})

function stateWithFlow(blocks: FlowBlock[]): State {
  const state = newState()
  state.flow = { blocks, at: 0, done: 0 }
  return state
}

/** Records what the flow asked for rather than applying it. */
function recorder(): { seen: HostAction[]; apply: (a: HostAction) => void } {
  const seen: HostAction[] = []
  return { seen, apply: (a) => void seen.push(a) }
}

test('a block spends one question per advance, then rolls over', () => {
  const state = stateWithFlow([block({ count: 2 }), block({ game: 'quizbowl' })])
  const { apply } = recorder()
  advanceFlow(state, apply)
  assert.deepEqual([state.flow!.at, state.flow!.done], [0, 1])
  advanceFlow(state, apply)
  assert.deepEqual([state.flow!.at, state.flow!.done], [1, 0])
})

test('a spent flow sits at its end rather than wrapping', () => {
  const state = stateWithFlow([block({ count: 1 })])
  const { seen, apply } = recorder()
  advanceFlow(state, apply)
  assert.equal(state.flow!.at, 1)
  const after = seen.length
  advanceFlow(state, apply)
  assert.equal(state.flow!.at, 1)
  assert.equal(seen.length, after, 'a spent flow applies nothing')
})

test('the mode is applied once per block, not once per question', () => {
  const state = stateWithFlow([block({ count: 3 }), block({ game: 'quizbowl' })])
  const { seen, apply } = recorder()
  advanceFlow(state, apply) // 1 of 3
  advanceFlow(state, apply) // 2 of 3
  assert.equal(seen.filter((a) => a.a === 'setGame').length, 0)
  advanceFlow(state, apply) // rolls into quizbowl
  assert.deepEqual(seen.filter((a) => a.a === 'setGame'), [
    { a: 'setGame', id: 'quizbowl', options: {}, keepScores: true },
  ])
})

test('entering a block keeps the standings across a mode switch', () => {
  const state = stateWithFlow([block({ game: 'quizbowl', options: { powerAfterFragment: 2 } })])
  const { seen, apply } = recorder()
  enterBlock(state, apply, true)
  assert.deepEqual(seen[0], {
    a: 'setGame',
    id: 'quizbowl',
    options: { powerAfterFragment: 2 },
    keepScores: true,
  })
})

test('the value applies only when the block declares one', () => {
  const withValue = stateWithFlow([block({ value: 400 })])
  const r1 = recorder()
  enterBlock(withValue, r1.apply, true)
  assert.deepEqual(r1.seen[1], { a: 'setValue', value: 400 })

  const without = stateWithFlow([block()])
  const r2 = recorder()
  enterBlock(without, r2.apply, true)
  assert.equal(r2.seen.some((a) => a.a === 'setValue'), false)
})

test('a duel block opens a duel every question; a plain block opens none', () => {
  const state = stateWithFlow([block({ count: 3, duel: 'vote' })])
  const { seen, apply } = recorder()
  advanceFlow(state, apply)
  advanceFlow(state, apply)
  assert.deepEqual(
    seen.filter((a) => a.a === 'openDuel'),
    [{ a: 'openDuel', rule: 'vote' }, { a: 'openDuel', rule: 'vote' }],
  )

  const plain = stateWithFlow([block({ count: 3 })])
  const r = recorder()
  advanceFlow(plain, r.apply)
  assert.equal(r.seen.length, 0)
})

test('the value is stamped on entry, not re-stamped by every question within the block', () => {
  const state = stateWithFlow([block({ count: 3, value: 400 })])
  const { seen, apply } = recorder()
  enterBlock(state, apply, true) // the initial, fresh entry — as the flow's own setup would do
  advanceFlow(state, apply) // still inside the block: not fresh
  advanceFlow(state, apply) // still inside the block: not fresh
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
