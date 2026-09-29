import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../shared/random.ts'
import { chipStack, pitch, slide, sweep, toss, TOSS, type Frame } from './toss.ts'

const along = (frames: Frame[], dx: number, dy: number) => {
  const len = Math.hypot(dx, dy)
  return frames.map((f) => ((f.x - frames[0].x) * dx + (f.y - frames[0].y) * dy) / len)
}

test('a slide starts where it is thrown from and rests exactly on its spot', () => {
  const frames = slide({ x: 0, y: 0, rot: 40 }, { x: 300, y: 400, rot: 5 }, mulberry32(1))
  assert.deepEqual({ x: frames[0].x, y: frames[0].y, rot: frames[0].rot }, { x: 0, y: 0, rot: 40 })
  const last = frames[frames.length - 1]
  assert.deepEqual({ x: last.x, y: last.y, rot: last.rot, lift: last.lift }, { x: 300, y: 400, rot: 5, lift: 0 })
})

test('friction only ever slows a slide down', () => {
  const frames = slide({ x: 0, y: 0, rot: 0 }, { x: 600, y: 0, rot: 0 }, mulberry32(2))
  const progress = along(frames, 600, 0)
  const steps = progress.slice(1).map((p, i) => p - progress[i])
  for (let i = 1; i < steps.length - 1; i++) assert.ok(steps[i] <= steps[i - 1] + 1e-6, `sped up at frame ${i}`)
  assert.ok(steps.every((s) => s >= -1e-6), 'went backwards')
})

test('a slide takes the time constant friction needs for its distance', () => {
  const near = slide({ x: 0, y: 0, rot: 0 }, { x: 200, y: 0, rot: 0 }, mulberry32(3))
  const far = slide({ x: 0, y: 0, rot: 0 }, { x: 800, y: 0, rot: 0 }, mulberry32(3))
  const time = (f: Frame[]) => f[f.length - 1].t
  assert.ok(Math.abs(time(far) - Math.sqrt((2 * 800) / TOSS.friction)) < TOSS.stepMs)
  assert.ok(time(far) > time(near))
})

test('the path wanders sideways in flight but not at either end', () => {
  const frames = slide({ x: 0, y: 0, rot: 0 }, { x: 0, y: 500, rot: 0 }, mulberry32(4))
  const side = frames.map((f) => Math.abs(f.x))
  assert.equal(side[0], 0)
  assert.equal(side[side.length - 1], 0)
  assert.ok(Math.max(...side) > 2, 'no wander at all')
  assert.ok(Math.max(...side) < 500 * 0.12, 'wanders off the path')
})

test('a card is lifted when it leaves the hand and lands before it stops', () => {
  const frames = slide({ x: 0, y: 0, rot: 0 }, { x: 500, y: 0, rot: 0 }, mulberry32(5))
  assert.ok(frames[0].lift > 0)
  const landed = frames.findIndex((f) => f.lift === 0)
  assert.ok(landed > 0 && landed < frames.length * 0.6, 'lands too late to slide')
})

test('the same seed throws the same card', () => {
  const a = pitch({ x: 500, y: -60 }, { x: 200, y: 600, rot: -4 }, mulberry32(6))
  const b = pitch({ x: 500, y: -60 }, { x: 200, y: 600, rot: -4 }, mulberry32(6))
  assert.deepEqual(a, b)
})

test('a dealer pitch spins in from the dealer and settles square on the spot', () => {
  const frames = pitch({ x: 500, y: -60 }, { x: 200, y: 600, rot: -4 }, mulberry32(7))
  assert.deepEqual({ x: frames[0].x, y: frames[0].y }, { x: 500, y: -60 })
  assert.ok(Math.abs(frames[0].rot - -4) >= 30, 'no spin')
  assert.equal(frames[frames.length - 1].rot, -4)
})

test('a harder flick throws further and spins more; a timeout only nudges the cards', () => {
  const from = { x: 500, y: 700, rot: 0 }
  const aim = { x: 500, y: 300 }
  const hard = toss(from, aim, { dx: 0, dy: -1, speed: 1 }, mulberry32(8))
  const soft = toss(from, aim, { dx: 0, dy: -1, speed: 0.15 }, mulberry32(8))
  const limp = toss(from, aim, null, mulberry32(8))
  const dist = (r: { rest: { x: number; y: number } }) => Math.hypot(r.rest.x - from.x, r.rest.y - from.y)
  assert.ok(dist(hard) > dist(soft))
  assert.ok(dist(soft) > dist(limp))
  assert.ok(Math.abs(hard.rest.rot) > Math.abs(soft.rest.rot))
  assert.ok(limp.frames.every((f) => f.lift === 0), 'a timeout slides, it is not thrown')
  assert.ok(hard.rest.y < from.y, 'goes toward the middle')
})

test('a flick to one side bends the toss that way', () => {
  const from = { x: 500, y: 700, rot: 0 }
  const right = toss(from, { x: 500, y: 300 }, { dx: 0.7, dy: -0.7, speed: 0.8 }, mulberry32(9))
  assert.ok(right.rest.x > from.x)
})

test('the dealer sweeps without throwing', () => {
  const frames = sweep({ x: 500, y: 350, rot: 60 }, { x: 700, y: 300, rot: 0 })
  assert.ok(frames.every((f) => f.lift === 0))
  assert.deepEqual(frames[frames.length - 1], { ...frames[frames.length - 1], x: 700, y: 300, rot: 0 })
})

test('a bet stacks as the fewest chips, biggest at the bottom', () => {
  assert.deepEqual(chipStack(137), [100, 25, 5, 5, 1, 1])
  assert.deepEqual(chipStack(0), [])
  assert.ok(chipStack(99_999).length <= 10)
  assert.equal(chipStack(99_999)[0], 500)
})
