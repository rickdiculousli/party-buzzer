import assert from 'node:assert/strict'
import test from 'node:test'
import { NO_CROSSING, easeToward, watchCrossing } from './tug.ts'

test('the first excursion picks a half without a cue', () => {
  const { next, crossed } = watchCrossing(NO_CROSSING, 0.3, 1000)
  assert.equal(crossed, false)
  assert.equal(next.half, 1)
})

test('a crossing needs to clear the margin and cues once', () => {
  let c = watchCrossing(NO_CROSSING, -0.4, 0).next
  const near = watchCrossing(c, 0.05, 5000)
  assert.equal(near.crossed, false)
  const over = watchCrossing(c, 0.2, 5000)
  assert.equal(over.crossed, true)
  assert.equal(watchCrossing(over.next, 0.3, 5100).crossed, false)
})

test('crossings are at most one per 1.5 s and fire late when held back', () => {
  let c = watchCrossing(NO_CROSSING, -0.4, 0).next
  const first = watchCrossing(c, 0.2, 5000)
  assert.equal(first.crossed, true)
  const quick = watchCrossing(first.next, -0.2, 5500)
  assert.equal(quick.crossed, false)
  assert.equal(watchCrossing(quick.next, -0.2, 6600).crossed, true)
})

test('easing approaches the target and is frame-rate independent', () => {
  const once = easeToward(0, 1, 32)
  const twice = easeToward(easeToward(0, 1, 16), 1, 16)
  assert.ok(Math.abs(once - twice) < 1e-9)
  assert.ok(once > 0 && once < 1)
  assert.equal(easeToward(0.5, 1, 0), 0.5)
})
