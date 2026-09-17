import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../bow/world.ts'
import type { InkInput } from '../../../shared/protocol.ts'
import { CARDS } from './fixtures.ts'
import { applyInk, createInkWorld, inkFinished, inkResults, leadingChoice, peekTargets, roleOf } from './world.ts'
import type { InkWorld } from './types.ts'

/** Sun: sw writes, s1 s2 guess. Moon: mw writes, m1 guesses. */
function world(): InkWorld {
  return createInkWorld({
    rand: mulberry32(1),
    cards: CARDS,
    participants: ['m1', 'mw', 's1', 's2', 'sw'],
    lobby: { teams: { sw: 'sun', s1: 'sun', s2: 'sun', mw: 'moon', m1: 'moon' }, volunteers: ['sw', 'mw'] },
  })
}

let at = 0
const act = (w: InkWorld, player: string, input: Record<string, unknown>) =>
  applyInk(w, player, { at: ++at, ...input } as InkInput)

function started(): InkWorld {
  const w = world()
  act(w, 'sw', { kind: 'pickWord', index: 2 })
  act(w, 'mw', { kind: 'pickWord', index: 2 })
  return w
}

test('volunteers write, everyone else guesses, and each team holds seven prompts', () => {
  const w = world()
  assert.deepEqual(w.roster, { sun: { writer: 'sw', guessers: ['s1', 's2'] }, moon: { writer: 'mw', guessers: ['m1'] } })
  assert.equal(w.hands.sun.length, 7)
  assert.equal(w.hands.moon.length, 7)
  assert.equal(w.deck.length, 6)
  assert.equal(w.wordCard.length, 6)
  assert.deepEqual(roleOf(w, 's1'), { team: 'sun', role: 'guesser' })
  assert.equal(roleOf(w, 'stranger'), null)
})

test('without volunteers a team member is drawn as writer', () => {
  const w = createInkWorld({
    rand: mulberry32(3), cards: CARDS, participants: ['a', 'b', 'c', 'd'],
    lobby: { teams: { a: 'sun', b: 'sun', c: 'moon', d: 'moon' }, volunteers: [] },
  })
  assert.ok(['a', 'b'].includes(w.roster.sun.writer))
  assert.equal(w.roster.sun.guessers.length, 1)
})

test('the secret word locks once both writers pick the same word', () => {
  const w = world()
  assert.deepEqual(act(w, 's1', { kind: 'pickWord', index: 1 }), { status: 'refused', reason: 'not-allowed' })
  act(w, 'sw', { kind: 'pickWord', index: 1 })
  act(w, 'mw', { kind: 'pickWord', index: 3 })
  assert.equal(w.secret, null)
  act(w, 'sw', { kind: 'pickWord', index: 3 })
  assert.equal(w.secret, 'Chili')
  assert.equal(w.turn, 'sun')
  assert.deepEqual(w.step, { at: 'choose' })
})

test('a vote applies when every guesser agrees', () => {
  const w = started()
  act(w, 's1', { kind: 'vote', choice: 'ask' })
  assert.deepEqual(w.step, { at: 'choose' })
  act(w, 's2', { kind: 'vote', choice: 'guess' })
  assert.deepEqual(w.step, { at: 'choose' })
  act(w, 's2', { kind: 'vote', choice: 'ask' })
  assert.deepEqual(w.step, { at: 'offer' })
  assert.deepEqual(w.votes, [])
})

test('the other team and the writer cannot vote; invalid choices are refused', () => {
  const w = started()
  assert.equal(act(w, 'm1', { kind: 'vote', choice: 'ask' }).status, 'refused')
  assert.equal(act(w, 'sw', { kind: 'vote', choice: 'ask' }).status, 'refused')
  assert.equal(act(w, 's1', { kind: 'vote', choice: 'fly' }).status, 'refused')
})

test('force applies the leading choice, earliest to reach the count on a tie', () => {
  assert.equal(leadingChoice([]), null)
  assert.equal(leadingChoice([
    { player: 'a', choice: 'guess', seq: 1 },
    { player: 'b', choice: 'ask', seq: 2 },
  ]), 'guess')
  assert.equal(leadingChoice([
    { player: 'a', choice: 'guess', seq: 1 },
    { player: 'b', choice: 'ask', seq: 2 },
    { player: 'c', choice: 'ask', seq: 3 },
  ]), 'ask')
  const w = started()
  assert.equal(act(w, 's1', { kind: 'force' }).status, 'refused')
  act(w, 's1', { kind: 'vote', choice: 'guess' })
  act(w, 's2', { kind: 'force' })
  assert.equal(w.step.at, 'guess')
})

test('prompt pairs match regardless of order', () => {
  const w = started()
  act(w, 's1', { kind: 'vote', choice: 'ask' })
  act(w, 's2', { kind: 'vote', choice: 'ask' })
  act(w, 's1', { kind: 'vote', choice: `${w.hands.sun[0]},${w.hands.sun[1]}` })
  act(w, 's2', { kind: 'vote', choice: `${w.hands.sun[1]},${w.hands.sun[0]}` })
  assert.equal(w.step.at, 'keep')
})
