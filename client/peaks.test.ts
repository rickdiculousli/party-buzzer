import test from 'node:test'
import assert from 'node:assert/strict'
import { peaks } from './peaks.ts'

test('one min/max column per requested width', () => {
  const data = new Float32Array(100).fill(0.5)
  assert.equal(peaks(data, 20).length, 20)
  assert.equal(peaks(data, 1).length, 1)
})

test('a column carries the extremes of the samples under it', () => {
  const data = new Float32Array([0, 1, -1, 0, 0.25, -0.25, 0, 0])
  const [a, b] = peaks(data, 2)
  assert.deepEqual(a, { min: -1, max: 1 })
  assert.deepEqual(b, { min: -0.25, max: 0.25 })
})

test('silence stays flat', () => {
  const out = peaks(new Float32Array(64), 8)
  for (const p of out) assert.deepEqual(p, { min: 0, max: 0 })
})

// The draw width is pixels and the file may be shorter than the panel is wide.
// Every column still has to carry a value, or the path string has a hole in it.
test('a width larger than the sample count still fills every column', () => {
  const out = peaks(new Float32Array([1, -1]), 6)
  assert.equal(out.length, 6)
  for (const p of out) assert.ok(Number.isFinite(p.min) && Number.isFinite(p.max))
})

test('an empty buffer is flat rather than NaN', () => {
  assert.deepEqual(peaks(new Float32Array(0), 3), [
    { min: 0, max: 0 },
    { min: 0, max: 0 },
    { min: 0, max: 0 },
  ])
})
