import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../../../shared/random.ts'
import { equity } from './equity.ts'

test('the turn is exact: aces against kings with two kings left', () => {
  const odds = equity({ a: ['As', 'Ah'], b: ['Kd', 'Kc'] }, ['2c', '7d', '9h', 'Js'], mulberry32(1))
  assert.equal(odds.a.toFixed(3), (42 / 44).toFixed(3))
  assert.equal((odds.a + odds.b).toFixed(6), '1.000000')
})

test('the board plays on the river: an even split', () => {
  const odds = equity({ a: ['2c', '3d'], b: ['4c', '5d'] }, ['As', 'Ks', 'Qd', 'Jc', 'Th'], mulberry32(1))
  assert.deepEqual(odds, { a: 0.5, b: 0.5 })
})

test('preflop samples, seeded', () => {
  const odds = equity({ a: ['As', 'Ah'], b: ['Kd', 'Kc'] }, [], mulberry32(1))
  assert.ok(odds.a > 0.78 && odds.a < 0.86, String(odds.a))
  assert.deepEqual(odds, equity({ a: ['As', 'Ah'], b: ['Kd', 'Kc'] }, [], mulberry32(1)))
})
