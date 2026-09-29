import test from 'node:test'
import assert from 'node:assert/strict'
import { awardPots, buildPots } from './pots.ts'

test('an all in for less makes a main pot and a side pot', () => {
  assert.deepEqual(buildPots({ a: 100, b: 300, c: 300 }, []), [
    { amount: 300, eligible: ['a', 'b', 'c'] },
    { amount: 400, eligible: ['b', 'c'] },
  ])
})

test('folded chips stay in the pot but the folder is not eligible', () => {
  assert.deepEqual(buildPots({ a: 50, b: 200, c: 200 }, ['a']), [{ amount: 450, eligible: ['b', 'c'] }])
})

test('an uncalled bet is a pot of one', () => {
  assert.deepEqual(buildPots({ a: 500, b: 200 }, []), [
    { amount: 400, eligible: ['a', 'b'] },
    { amount: 300, eligible: ['a'] },
  ])
})

test('three all ins of different sizes', () => {
  const pots = buildPots({ a: 100, b: 250, c: 600, d: 600 }, [])
  assert.deepEqual(pots.map((pot) => pot.amount), [400, 450, 700])
  assert.equal(pots.reduce((sum, pot) => sum + pot.amount, 0), 1550)
})

test('a split pot gives the odd chip to the first winner left of the button', () => {
  const won = awardPots([{ amount: 301, eligible: ['a', 'b', 'c'] }], { a: [1, 5], b: [4, 9], c: [4, 9] }, ['c', 'a', 'b'])
  assert.deepEqual(won, { c: 151, b: 150 })
})

test('each pot goes to the best hand among its eligible players', () => {
  const pots = buildPots({ a: 100, b: 300, c: 300 }, [])
  const won = awardPots(pots, { a: [8, 12], b: [5, 3], c: [1, 2] }, ['a', 'b', 'c'])
  assert.deepEqual(won, { a: 300, b: 400 })
})
