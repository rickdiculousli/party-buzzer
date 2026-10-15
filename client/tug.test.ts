import assert from 'node:assert/strict'
import test from 'node:test'
import { NO_CROSSING, easeToward, follow, tense, watchCrossing } from './tug.ts'

test('a swing cues on the frame the flag crosses the centre, once armed past the margin', () => {
  let c = watchCrossing(NO_CROSSING, 0.03, 0).next
  assert.equal(watchCrossing(c, -0.01, 100).crossed, false, 'a wobble that never cleared the margin is not a swing')
  c = watchCrossing(c, 0.2, 200).next
  assert.equal(watchCrossing(c, 0.04, 300).crossed, false, 'still on the armed side')
  const over = watchCrossing(c, -0.001, 5000)
  assert.equal(over.crossed, true, 'cues exactly at the centre line')
  assert.equal(watchCrossing(over.next, -0.02, 5050).crossed, false, 'once')
})

test('no more than one swing cue per gap; a swing inside it passes silently', () => {
  let c = watchCrossing(NO_CROSSING, -0.4, 0).next
  const first = watchCrossing(c, 0.01, 5000)
  assert.equal(first.crossed, true)
  c = watchCrossing(first.next, 0.2, 5200).next
  const quick = watchCrossing(c, -0.01, 5600)
  assert.equal(quick.crossed, false)
  c = watchCrossing(quick.next, -0.2, 5800).next
  assert.equal(watchCrossing(c, 0.01, 7000).crossed, true, 'the next swing after the gap cues')
})

test('the flag shakes only in a stalemate, without flicker', () => {
  assert.equal(tense(false, [0.7, 0.7], 0), true)
  assert.equal(tense(false, [0.7, 0.3], 0), false, 'one side pulling alone is not a stalemate')
  assert.equal(tense(false, [0.7, 0.7], 0.5), false, 'a running flag is not a stalemate')
  assert.equal(tense(true, [0.55, 0.55], 0.25), true, 'once on, it holds through small dips')
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
