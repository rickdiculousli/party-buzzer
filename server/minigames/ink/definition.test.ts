import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../bow/world.ts'
import { makeInk } from './definition.ts'
import { CARDS } from './fixtures.ts'
import type { InkWorld } from './types.ts'

const lobby = { teams: { sw: 'sun', s1: 'sun', mw: 'moon', m1: 'moon' } as const, volunteers: ['sw', 'mw'] }
const clock = (ms: number) => ms

function setup() {
  const ink = makeInk(() => CARDS, mulberry32(5))
  assert.equal(ink.prepare?.(), null)
  const { world } = ink.create(1, ['m1', 'mw', 's1', 'sw'], {}, { teams: { ...lobby.teams }, volunteers: [...lobby.volunteers] })
  return { ink, world }
}

test('prepare reports missing cards', () => {
  assert.equal(makeInk(() => 'missing').prepare?.(), 'ink-cards')
})

test('start uses the lobby rules', () => {
  const ink = makeInk(() => CARDS)
  assert.equal(ink.startable?.({ teams: { a: 'sun' }, volunteers: [] }, ['a', 'b']), 'unpicked')
})

test('classify accepts well-formed inputs only', () => {
  const { ink } = setup()
  assert.equal(ink.classify({ kind: 'ink', points: [[0, 0]] }), 'continuous')
  assert.equal(ink.classify({ kind: 'stroke', points: [[0, 0]], at: 1 }), 'discrete')
  assert.equal(ink.classify({ kind: 'judge', correct: true, at: 1 }), 'discrete')
  assert.equal(ink.classify({ kind: 'judge', correct: 'yes', at: 1 }), null)
  assert.equal(ink.classify({ kind: 'vote', choice: 3, at: 1 }), null)
  assert.equal(ink.classify({ kind: 'stop' }), null)
  assert.equal(ink.classify({ kind: 'nope', at: 1 }), null)
})

test('the board never sees the secret word, hands, votes or word card', () => {
  const { ink, world } = setup()
  ink.apply(world, 'sw', { kind: 'pickWord', index: 0, at: 1 })
  ink.apply(world, 'mw', { kind: 'pickWord', index: 0, at: 2 })
  ink.apply(world, 's1', { kind: 'vote', choice: 'ask', at: 3 })
  const board = JSON.stringify(ink.boardFrame(world, clock))
  assert.ok(!board.includes('Apple'))
  assert.ok(!board.includes('"hand"'))
  assert.ok(!board.includes('"votes"'))
  const shared = ink.boardFrame(world, clock) as { secret: string | null }
  assert.equal(shared.secret, null)
})

test('guessers see their hand and votes; the other team does not; writers see the secret word', () => {
  const { ink, world } = setup()
  ink.apply(world, 'sw', { kind: 'pickWord', index: 0, at: 1 })
  ink.apply(world, 'mw', { kind: 'pickWord', index: 0, at: 2 })
  const s1 = ink.playerFrame(world, 's1', clock) as { hand: unknown[]; secret: string | null; votes: unknown[] }
  const m1 = ink.playerFrame(world, 'm1', clock) as { hand: { id: number }[]; votes: unknown[] }
  const sw = ink.playerFrame(world, 'sw', clock) as { hand: unknown[]; secret: string | null }
  assert.equal(s1.hand.length, 7)
  assert.equal(s1.secret, null)
  assert.equal(sw.secret, 'Apple')
  assert.deepEqual(sw.hand, [])
  assert.ok(m1.hand.every((card) => world.hands.moon.includes(card.id)))
  assert.equal(ink.playerFrame(world, 'stranger', clock), null)
})

test('the full pad rides a frame only when it changed or once a second', () => {
  const { ink, world } = setup()
  const hasPad = () => 'pad' in (ink.boardFrame(world, clock) as object)
  assert.equal(hasPad(), true)
  ink.afterFrame!(world)
  assert.equal(hasPad(), false)
  world.padVersion++
  assert.equal(hasPad(), true)
  ink.afterFrame!(world)
  for (let i = 0; i < 20; i++) ink.step(world)
  assert.equal(hasPad(), true)
})

test('touches on cards reach teammates; touches on rows also reach the board', () => {
  const { ink, world } = setup()
  assert.deepEqual(ink.touchAudience!(world, 's1', 'card:3'), { players: ['sw', 's1'], board: false })
  assert.deepEqual(ink.touchAudience!(world, 'm1', 'row:sun:0'), { players: ['mw', 'm1'], board: true })
  assert.equal(ink.touchAudience!(world, 'stranger', 'card:3'), null)
})

test('the game is finished once over', () => {
  const { ink, world } = setup()
  assert.equal(ink.finished!(world), false)
  ;(world as InkWorld).step = { at: 'over', winner: null }
  assert.equal(ink.finished!(world), true)
})
