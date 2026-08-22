import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTune, spacedPlan } from './sound.ts'

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

// Today's samples all have onset zero — trimming dead air off the front is
// exactly what `head` does — so this is the case every shipped cue takes, and
// lead compensation must not shift it by a sample.
test('a sample cue with no onset is scheduled exactly on its slot', () => {
  const p = spacedPlan(1000, 0, 100, [0])
  assert.deepEqual(p.offsets, [0])
  assert.equal(p.free, 1100)
})

test('a cue with an onset starts earlier than its slot by exactly that much', () => {
  const p = spacedPlan(1000, 1300, 100, [120])
  // Heard at 1300, so it starts at 1180 — 180ms from now.
  assert.deepEqual(p.offsets, [180])
  assert.equal(p.free, 1400)
})

test('cues in one moment share the slot and are each pulled back by their own onset', () => {
  const p = spacedPlan(1000, 1300, 100, [0, 120])
  assert.deepEqual(p.offsets, [300, 180])
  assert.equal(p.free, 1400, 'one moment costs one gap, not one per cue')
})

// Less lead than onset: the cue cannot start before now, so it is simply late.
// Late is the honest answer here; a negative offset is not.
test('an onset longer than the lead clamps to now rather than to the past', () => {
  const p = spacedPlan(1000, 1000, 100, [120])
  assert.deepEqual(p.offsets, [0])
})

test('a moment arriving into a quiet room does not wait', () => {
  const p = spacedPlan(5000, 1000, 100, [0])
  assert.deepEqual(p.offsets, [0])
  assert.equal(p.free, 5100)
})
