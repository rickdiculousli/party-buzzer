import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BEND_ANGLE, BEND_TABLE_SEGMENTS, bendAngle, bendArc, bendTable } from './poker-bend.ts'

test('bend leaves the cloth tangent gradually and joins the raised plane continuously', () => {
  const length = 70, epsilon = 0.001
  assert.equal(bendAngle(0, length), 0)
  assert.equal(bendAngle(length, length), BEND_ANGLE)
  const start = bendArc(epsilon, length)
  assert.ok(Math.abs(start.q + epsilon) < 1e-9)
  assert.ok(Math.abs(start.z) < 1e-9)
  const at = bendArc(length, length), past = bendArc(length + epsilon, length)
  assert.ok(Math.abs((past.q - at.q) / epsilon + Math.cos(BEND_ANGLE)) < 1e-8)
  assert.ok(Math.abs((past.z - at.z) / epsilon - Math.sin(BEND_ANGLE)) < 1e-8)
})

test('GPU arc table stays within a fraction of a phone pixel across the shared bend', () => {
  const table = bendTable(), length = 80
  for (let s = 0; s <= length; s += 0.1) {
    const index = s / length * BEND_TABLE_SEGMENTS, lo = Math.min(Math.floor(index), BEND_TABLE_SEGMENTS - 1), f = index - lo
    const q = (table[lo * 2] * (1 - f) + table[(lo + 1) * 2] * f) * length
    const z = (table[lo * 2 + 1] * (1 - f) + table[(lo + 1) * 2 + 1] * f) * length
    const exact = bendArc(s, length)
    assert.ok(Math.hypot(q - exact.q, z - exact.z) < 0.03)
  }
})
