import test from 'node:test'
import assert from 'node:assert/strict'
import * as tankControl from './tank-control.ts'
import {
  coverPath, reloadProgress,
} from './tank-control.ts'

const close = (actual: number, expected: number) => assert.ok(
  Math.abs(actual - expected) < 1e-10,
  `expected ${actual} to be close to ${expected}`,
)

test('reload progress fills from 0 to 1 and stays full when ready', () => {
  const weapon = { clip: 0, size: 1, reloadUntil: 5_000, reloadMs: 3_000 }
  assert.equal(reloadProgress(weapon, 2_000), 0)
  assert.equal(reloadProgress(weapon, 3_500), 0.5)
  assert.equal(reloadProgress(weapon, 6_000), 1)
})

test('board angles take the short path across the wrapped angle seam', () => {
  const nearest = (tankControl as typeof tankControl & {
    nearestAngleDegrees?: (previous: number | undefined, radians: number) => number
  }).nearestAngleDegrees
  assert.equal(typeof nearest, 'function')
  close(nearest!(179, -179 * Math.PI / 180), 181)
  close(nearest!(-179, 179 * Math.PI / 180), -181)
  close(nearest!(undefined, Math.PI / 2), 90)
})

test('tank view rotates to one fixed landscape side for every reported orientation', () => {
  const rotate = (tankControl as typeof tankControl & {
    tankViewRotation?: (screenAngle: number, viewportLandscape: boolean) => number
  }).tankViewRotation
  assert.deepEqual([
    rotate?.(0, false),
    rotate?.(180, false),
    rotate?.(90, true),
    rotate?.(270, true),
    rotate?.(-90, true),
    rotate?.(0, true),
  ], [90, -90, 0, 180, 180, 0])
})

test('cover becomes one path with a rectangle per run of solid cells', () => {
  const cells = new Uint8Array(160 * 90)
  cells[2] = cells[3] = cells[4] = 1
  cells[160] = 1
  assert.equal(coverPath(cells), 'M20 0h30v10h-30zM0 10h10v10h-10z')
})
