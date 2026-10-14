import assert from 'node:assert/strict'
import test from 'node:test'
import { NO_CROSSING, easeToward, follow, watchCrossing } from './tug.ts'

test('the first excursion picks a half without a cue', () => {
  const { next, crossed } = watchCrossing(NO_CROSSING, 0.3, 1000)
  assert.equal(crossed, false)
  assert.equal(next.half, 1)
})

test('a crossing needs to clear the margin and cues once', () => {
  let c = watchCrossing(NO_CROSSING, -0.4, 0).next
  const near = watchCrossing(c, 0.03, 5000)
  assert.equal(near.crossed, false)
  const over = watchCrossing(near.next, 0.2, 5100)
  assert.equal(over.crossed, true)
  assert.equal(watchCrossing(over.next, 0.3, 5200).crossed, false)
})

test('a flag that creeps over the line long after passing it stays quiet', () => {
  let c = watchCrossing(NO_CROSSING, -0.4, 0).next
  c = watchCrossing(c, 0.01, 5000).next
  const late = watchCrossing(c, 0.06, 5600)
  assert.equal(late.crossed, false)
  assert.equal(late.next.half, 1, 'the half is still taken')
})

test('a swing inside the gap is taken silently, never cued late', () => {
  let c = watchCrossing(NO_CROSSING, -0.4, 0).next
  const first = watchCrossing(c, 0.2, 5000)
  assert.equal(first.crossed, true)
  const quick = watchCrossing(first.next, -0.2, 5500)
  assert.equal(quick.crossed, false)
  assert.equal(watchCrossing(quick.next, -0.2, 6600).crossed, false, 'still on the same half: no late cue')
  assert.equal(watchCrossing(quick.next, 0.2, 6600).crossed, true, 'the next real swing cues')
})

test('easing approaches the target and is frame-rate independent', () => {
  const once = easeToward(0, 1, 32, 300)
  const twice = easeToward(easeToward(0, 1, 16, 300), 1, 16, 300)
  assert.ok(Math.abs(once - twice) < 1e-9)
  assert.ok(once > 0 && once < 1)
  assert.equal(easeToward(0.5, 1, 0, 300), 0.5)
})

test('the rope heaves toward a step, carries a little past and settles, at any frame rate', () => {
  const run = (frameMs: number) => {
    let rope = { x: 0, v: 0 }, peak = 0
    for (let t = 0; t < 2000; t += frameMs) { rope = follow(rope, 1, frameMs); peak = Math.max(peak, rope.x) }
    return { rope, peak }
  }
  const smooth = run(1000 / 60), slow = run(1000 / 30)
  assert.ok(Math.abs(smooth.rope.x - 1) < 0.01 && Math.abs(smooth.rope.v) < 0.05, 'settled within two seconds')
  assert.ok(smooth.peak > 1 && smooth.peak < 1.05, `a slight carry past (${smooth.peak})`)
  assert.ok(Math.abs(smooth.peak - slow.peak) < 0.005, '30 and 60 fps move alike')
  let rope = { x: 0, v: 0 }
  rope = follow(rope, 0.12, 1000 / 60)
  assert.ok(rope.x < 0.01, `one 1v1 tap does not jolt the flag in a frame (${rope.x})`)
})
