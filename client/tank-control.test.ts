import test from 'node:test'
import assert from 'node:assert/strict'
import * as tankControl from './tank-control.ts'
import {
  coverPath, lengthwiseTilt, reloadProgress, tiltTurnRate,
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

test('lengthwise tilt is the folded beta axis with no orientation or level inversion', () => {
  close(lengthwiseTilt(-30), -30)
  close(lengthwiseTilt(30), 30)
  close(lengthwiseTilt(-150), -30)
  close(lengthwiseTilt(150), 30)
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

test('driver tilt ramps from a 2 degree deadzone to full speed at 30 degrees', () => {
  assert.equal(tiltTurnRate(2, 'driver'), 0)
  close(tiltTurnRate(16, 'driver'), 0.5)
  close(tiltTurnRate(30, 'driver'), 1)
  close(tiltTurnRate(-80, 'driver'), -1)
})

test('gunner tilt ramps from a 1 degree deadzone to full speed at 30 degrees', () => {
  assert.equal(tiltTurnRate(1, 'gunner'), 0)
  assert.ok(tiltTurnRate(1.01, 'gunner') > 0)
  close(tiltTurnRate(15.5, 'gunner'), 2 / 3)
  close(tiltTurnRate(30, 'gunner'), 4 / 3)
  close(tiltTurnRate(-80, 'gunner'), -4 / 3)
})

test('tilt indicator clamps at full turn and marks the threshold as maxed', () => {
  const feedback = (tankControl as typeof tankControl & {
    tiltIndicatorFeedback?: (tilt: number | null) => { angle: number, maxed: boolean }
  }).tiltIndicatorFeedback
  assert.equal(typeof feedback, 'function')
  assert.deepEqual(feedback!(null), { angle: 0, maxed: false })
  assert.deepEqual(feedback!(29), { angle: 29, maxed: false })
  assert.deepEqual(feedback!(30), { angle: 30, maxed: true })
  assert.deepEqual(feedback!(80), { angle: 30, maxed: true })
  assert.deepEqual(feedback!(-80), { angle: -30, maxed: true })
})

test('cover becomes one path with a rectangle per run of solid cells', () => {
  const cells = new Uint8Array(160 * 90)
  cells[2] = cells[3] = cells[4] = 1
  cells[160] = 1
  assert.equal(coverPath(cells), 'M20 0h30v10h-30zM0 10h10v10h-10z')
})
