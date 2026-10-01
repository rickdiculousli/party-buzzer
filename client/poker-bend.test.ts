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

test('the pair shares one material extent despite fractional placement and different exposed depths', async () => {
  const { bendProfile } = await import('./poker-bend.ts')
  const corners = [{ x: 0.188, y: 110.125 }, { x: 30.321, y: 150.75 }]
  const crease = { x: 12.125, y: 90.625 }, normal = { x: 0, y: -1 }
  const profile = bendProfile(corners, crease, normal, 226.188)
  assert.equal(profile.depth, 60.125)
  assert.equal(profile.length, 60.125 * 0.85)
  const translated = bendProfile(corners.map(p => ({ x: p.x + 25.5, y: p.y - 11.25 })), { x: crease.x + 25.5, y: crease.y - 11.25 }, normal, 226.188)
  assert.deepEqual(translated, profile)
  assert.deepEqual(bendProfile(corners, { x: 0, y: 300 }, normal, 226.188), { depth: 0, length: 0 })
})
