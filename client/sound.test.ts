import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTune } from './sound.ts'

// The values these read are written in one unit and shipped in another: the CSS
// minifier rewrites `1000ms` as `1s`, so a build silently divided every long
// duration by a thousand while dev stayed correct.
test('a time survives the unit the minifier chose', () => {
  assert.equal(parseTune('1000ms', 0), 1000)
  assert.equal(parseTune('1s', 0), 1000)
  assert.equal(parseTune('0.9s', 0), 900)
  assert.equal(parseTune('240ms', 0), 240)
  assert.equal(parseTune('0s', 9), 0)
})

test('unitless dials pass straight through', () => {
  assert.equal(parseTune('0.7', 1), 0.7)
  assert.equal(parseTune('.7', 1), 0.7)
  assert.equal(parseTune('3', 1), 3)
})

test('an unset property falls back rather than becoming NaN', () => {
  assert.equal(parseTune('', 0.5), 0.5)
  assert.equal(parseTune('   ', 0.5), 0.5)
})
