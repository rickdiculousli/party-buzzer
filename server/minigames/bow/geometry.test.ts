import test from 'node:test'
import assert from 'node:assert/strict'
import {
  add, sub, scale, dot, length, normalize,
  closestPointOnSegment, segmentCircleHit, segmentDistance,
} from './geometry.ts'

test('vector helpers preserve inputs and normalize with a stable zero fallback', () => {
  const a = { x: 3, y: 4 }
  const b = { x: -1, y: 2 }
  assert.deepEqual(add(a, b), { x: 2, y: 6 })
  assert.deepEqual(sub(a, b), { x: 4, y: 2 })
  assert.deepEqual(scale(a, 2), { x: 6, y: 8 })
  assert.equal(dot(a, b), 5)
  assert.equal(length(a), 5)
  assert.ok(Math.abs(length(normalize(a)) - 1) < 1e-12)
  assert.deepEqual(normalize({ x: 0, y: 0 }), { x: 0, y: -1 })
  assert.deepEqual(a, { x: 3, y: 4 })
})

test('closest point projects, clamps both endpoints, and handles a point segment', () => {
  const a = { x: 0, y: 0 }, b = { x: 10, y: 0 }
  for (const [x, t] of [[-2, 0], [4, 0.4], [12, 1]]) {
    assert.deepEqual(closestPointOnSegment({ x, y: 3 }, a, b), {
      point: { x: t * 10, y: 0 }, t,
    })
  }
  assert.deepEqual(closestPointOnSegment(b, a, a), { point: a, t: 0 })
})

test('swept circle contact is the first entry with an outward normal', () => {
  assert.deepEqual(segmentCircleHit({ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }, 3), {
    t: 0.35, point: { x: 7, y: 0 }, normal: { x: -1, y: 0 },
  })
})

test('swept circle contact handles misses, tangency, and endpoint contact', () => {
  const a = { x: 0, y: 0 }, b = { x: 20, y: 0 }
  assert.equal(segmentCircleHit(a, b, { x: 10, y: 4 }, 3), null)
  assert.equal(segmentCircleHit(a, b, { x: 24, y: 0 }, 3), null)
  assert.equal(segmentCircleHit(a, b, { x: -4, y: 0 }, 3), null)
  assert.deepEqual(segmentCircleHit(a, b, { x: 10, y: 3 }, 3), {
    t: 0.5, point: { x: 10, y: 0 }, normal: { x: 0, y: -1 },
  })
  assert.equal(segmentCircleHit(a, b, { x: 23, y: 0 }, 3)?.t, 1)
})

test('starting inside or on the circle is immediate contact, including stationary tips', () => {
  const center = { x: 0, y: 0 }
  for (const end of [center, { x: 20, y: 0 }]) {
    assert.deepEqual(segmentCircleHit(center, end, center, 3), {
      t: 0, point: center, normal: { x: 0, y: -1 },
    })
    assert.equal(segmentCircleHit({ x: 3, y: 0 }, end, center, 3)?.t, 0)
  }
  assert.equal(segmentCircleHit({ x: 4, y: 0 }, { x: 4, y: 0 }, center, 3), null)
})

test('segment distance handles crossings, parallel, collinear, and degenerate shafts symmetrically', () => {
  const cases = [
    [0, 0, 10, 10, 0, 10, 10, 0, 0],
    [0, 0, 10, 0, 0, 3, 10, 3, 3],
    [0, 0, 10, 0, 5, 0, 20, 0, 0],
    [0, 0, 10, 0, 13, 0, 20, 0, 3],
    [0, 0, 10, 0, 10, 0, 10, 10, 0],
    [0, 0, 0, 0, 3, 4, 3, 4, 5],
    [5, 3, 5, 3, 0, 0, 10, 0, 3],
    [0, 0, 1, 0, 2, -1, 2, 1, 1],
  ]
  for (const [ax, ay, bx, by, cx, cy, dx, dy, expected] of cases) {
    const a = { x: ax, y: ay }, b = { x: bx, y: by }
    const c = { x: cx, y: cy }, d = { x: dx, y: dy }
    assert.equal(segmentDistance(a, b, c, d), expected)
    assert.equal(segmentDistance(d, c, b, a), expected)
  }
})
