import test from 'node:test'
import assert from 'node:assert/strict'
import { COLS, ROWS } from './types.ts'
import { SPAWNS, carve, circleHitsCover, createCover, encodeCover } from './cover.ts'

test('cover is seeded, point-symmetric, and leaves spawns clear', () => {
  const cover = createCover(7, SPAWNS)
  assert.deepEqual(cover, createCover(7, SPAWNS))
  assert.ok(cover.some((cell) => cell === 1))
  for (let i = 0; i < cover.length; i++) assert.equal(cover[i], cover[cover.length - 1 - i])
  for (const spawn of SPAWNS) assert.equal(circleHitsCover(cover, spawn, 40), false)
})

test('a circle hits a solid cell only when its edge reaches the cell', () => {
  const cover = new Uint8Array(COLS * ROWS)
  cover[10 * COLS + 10] = 1 // x 100..110, y 100..110
  assert.equal(circleHitsCover(cover, { x: 95, y: 105 }, 6), true)
  assert.equal(circleHitsCover(cover, { x: 95, y: 105 }, 4), false)
})

test('carving clears cells the blast touches and reports them', () => {
  const cover = new Uint8Array(COLS * ROWS).fill(1)
  const cleared = carve(cover, { x: 505, y: 505 }, 8)
  assert.ok(cleared.includes(50 * COLS + 50))
  assert.equal(cover[50 * COLS + 50], 0)
  assert.equal(cover[50 * COLS + 53], 1)
  assert.deepEqual(carve(cover, { x: 505, y: 505 }, 8), [], 'already clear cells are not reported twice')
})

test('the encoded grid is one digit per cell', () => {
  const cover = new Uint8Array(COLS * ROWS)
  cover[3] = 1
  const encoded = encodeCover(cover)
  assert.equal(encoded.length, COLS * ROWS)
  assert.equal(encoded.slice(0, 5), '00010')
})
