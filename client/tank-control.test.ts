import test from 'node:test'
import assert from 'node:assert/strict'
import { reloadProgress, wheelTurns } from './tank-control.ts'

test('wheel turns follow the pointer the short way across the ±π seam', () => {
  assert.equal(wheelTurns(0, Math.PI / 2), 0.25)
  assert.ok(Math.abs(wheelTurns(3, -3) - (2 * Math.PI - 6) / (2 * Math.PI)) < 1e-12)
  assert.ok(Math.abs(wheelTurns(-3, 3) + (2 * Math.PI - 6) / (2 * Math.PI)) < 1e-12)
})

test('reload progress fills from 0 to 1 and stays full when ready', () => {
  const weapon = { clip: 0, size: 1, reloadUntil: 5_000, reloadMs: 3_000 }
  assert.equal(reloadProgress(weapon, 2_000), 0)
  assert.equal(reloadProgress(weapon, 3_500), 0.5)
  assert.equal(reloadProgress(weapon, 6_000), 1)
})
