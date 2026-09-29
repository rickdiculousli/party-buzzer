import test from 'node:test'
import assert from 'node:assert/strict'
import { DECK, handDeck } from './cards.ts'
import { best, compare } from './evaluate.ts'

test('names every category', () => {
  assert.equal(best(['As', 'Ks', 'Qs', 'Js', 'Ts', '2d', '3c']).name, 'Royal flush')
  assert.equal(best(['9h', '8h', '7h', '6h', '5h', '2d', '3c']).name, 'Straight flush, nine high')
  assert.equal(best(['9h', '9d', '9c', '9s', '5h', '2d', '3c']).name, 'Four of a kind, nines')
  assert.equal(best(['Kd', 'Kc', 'Ks', '7h', '7d', '2c', '3s']).name, 'Full house, kings over sevens')
  assert.equal(best(['Ah', '9h', '7h', '4h', '2h', 'Kd', 'Qc']).name, 'Flush, ace high')
  assert.equal(best(['7h', '7d', '7c', 'Ks', '2h', '4d', '9c']).name, 'Three of a kind, sevens')
  assert.equal(best(['Kh', 'Kd', '7c', '4s', '2h', '9d', 'Jc']).name, 'Pair of kings')
  assert.equal(best(['Ah', '9d', '7c', '4s', '2h', 'Td', 'Jc']).name, 'High card, ace')
  assert.equal(best(['6h', '6d', '7c', '4s', '2h', 'Td', 'Jc']).name, 'Pair of sixes')
})

test('the wheel is a five-high straight and loses to six high', () => {
  const wheel = best(['As', '2d', '3c', '4h', '5s', 'Kd', 'Qc'])
  assert.equal(wheel.name, 'Straight, five high')
  const six = best(['6s', '2d', '3c', '4h', '5s', 'Kd', 'Qc'])
  assert.ok(compare(six.score, wheel.score) > 0)
})

test('two pair keeps the best pairs and the best kicker', () => {
  const hand = best(['Ah', 'Ad', 'Kc', 'Kd', 'Qs', 'Qh', '2c'])
  assert.equal(hand.name, 'Two pair, aces and kings')
  assert.ok(hand.five.some((card) => card[0] === 'Q'))
  assert.equal(hand.five.length, 5)
})

test('the board plays: equal hands compare equal', () => {
  const board = ['As', 'Ks', 'Qd', 'Jc', 'Th']
  assert.equal(compare(best([...board, '2c', '3d']).score, best([...board, '4c', '5d']).score), 0)
})

test('flush beats straight, and a better kicker wins', () => {
  const flush = best(['Ah', '9h', '7h', '4h', '2h', 'Kd', 'Qc'])
  const straight = best(['6s', '7d', '8c', '9h', 'Ts', '2d', '2c'])
  assert.ok(compare(flush.score, straight.score) > 0)
  const aceKicker = best(['Kh', 'Kd', 'Ac', '4s', '2h', '9d', '8c'])
  const queenKicker = best(['Kh', 'Kd', 'Qc', '4s', '2h', '9d', '8c'])
  assert.ok(compare(aceKicker.score, queenKicker.score) > 0)
})

test('a hand deck is fixed by seed and hand number', () => {
  const deck = handDeck(7, 3)
  assert.deepEqual(deck, handDeck(7, 3))
  assert.equal(new Set(deck).size, 52)
  assert.deepEqual([...deck].sort(), [...DECK].sort())
  assert.notDeepEqual(deck, handDeck(7, 4))
})
