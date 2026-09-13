import test from 'node:test'
import assert from 'node:assert/strict'
import { aimFromDrag, canBowShoot, nextBowSequence } from './bow-control.ts'

test('pulling the string horizontally aims in the opposite direction', () => {
  assert.ok(aimFromDrag(100, 100).angle < 0)
  assert.ok(aimFromDrag(-100, 100).angle > 0)
})

test('aim follows the drag direction, not its length', () => {
  assert.equal(aimFromDrag(10, 20).angle, aimFromDrag(100, 200).angle)
})

test('bow input sequences continue across component reloads', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
  assert.equal(nextBowSequence(storage), 1)
  assert.equal(nextBowSequence(storage), 2)
  assert.equal(values.get('bowInputSeq'), '2')
})

test('shooting closes at the match deadline while arrows finish landing', () => {
  assert.equal(canBowShoot('playing', 5_000, 4_999, true, false), true)
  assert.equal(canBowShoot('playing', 5_000, 5_000, true, false), false)
})
