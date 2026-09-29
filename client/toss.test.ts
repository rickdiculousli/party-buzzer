import test from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../shared/random.ts'
import { chipStack, dealSchedule, pitch, receive, scatter, slide, sweep, toss, wildCard, RECEIVE, TOSS, type Frame } from './toss.ts'

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

test('a card flies fast, then the cloth slows it to a crawl', () => {
  const frames = slide({ x: 0, y: 0, rot: 0 }, { x: 700, y: 0, rot: 0 }, mulberry32(3))
  const total = frames[frames.length - 1].t
  const at = (share: number) => frames.find((f) => f.t >= total * share)!.x
  assert.ok(at(0.4) > 700 * 0.7, `only ${at(0.4)} by 40% of the time`)
  assert.ok(700 - at(0.6) < 700 * 0.1, `still ${700 - at(0.6)} to go in the last 40%`)
  const near = slide({ x: 0, y: 0, rot: 0 }, { x: 200, y: 0, rot: 0 }, mulberry32(3))
  assert.ok(total > near[near.length - 1].t)
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

test('a dealer pitch spins in the air and settles exactly on its spot', () => {
  for (let seed = 1; seed < 30; seed++) {
    const frames = pitch({ x: 500, y: -60 }, { x: 200, y: 600, rot: -4 }, mulberry32(seed))
    assert.ok(Math.abs(frames[0].rot - -4) >= 20, `barely spun: ${frames[0].rot}`)
    assert.deepEqual({ x: frames[0].x, y: frames[0].y }, { x: 500, y: -60 })
    assert.equal(frames[frames.length - 1].rot, -4)
  }
})

test('spin is quick in the air and the cloth drags it down', () => {
  const frames = pitch({ x: 500, y: -60 }, { x: 200, y: 700, rot: 0 }, mulberry32(5))
  const land = frames.findIndex((f) => f.lift === 0)
  const turn = (i: number) => Math.abs(frames[i + 1].rot - frames[i].rot)
  assert.ok(turn(land - 2) > 1.5 * turn(land + 1), `air ${turn(land - 2)} vs cloth ${turn(land + 1)}`)
  assert.ok(turn(frames.length - 3) < turn(land + 1), 'the cloth does not slow the spin')
})

test('a pushed card rides the hand before it is let go, then slows', () => {
  const frames = slide({ x: 0, y: 0, rot: 0 }, { x: 400, y: 0, rot: 0 }, mulberry32(12), { hand: 0.35, lift: 0 })
  const steps = frames.slice(1).map((f, i) => f.x - frames[i].x)
  const peak = steps.indexOf(Math.max(...steps))
  assert.ok(peak > 1 && peak < steps.length - 2, 'no hand phase')
  for (let i = 1; i <= peak; i++) assert.ok(steps[i] >= steps[i - 1] - 1e-6, 'the hand slowed')
  for (let i = peak + 1; i < steps.length - 1; i++) assert.ok(steps[i] <= steps[i - 1] + 1e-6, 'sped up after release')
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
  assert.ok(Math.abs(hard.rest.rot) > Math.abs(limp.rest.rot))
  assert.ok(limp.frames.every((f) => f.lift === 0), 'a timeout slides, it is not thrown')
  assert.ok(soft.frames.every((f) => f.lift === 0), 'a soft flick is a push along the cloth')
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

test('a dealt card lands loose near the seat, not squared on it', () => {
  const neat = { x: 400, y: 600, rot: 3 }
  let moved = 0
  for (let seed = 1; seed < 40; seed++) {
    const land = scatter(neat, 60, mulberry32(seed))
    const off = Math.hypot(land.x - neat.x, land.y - neat.y)
    assert.ok(off <= 60 * RECEIVE.scatter + 1e-9, `landed ${off} away`)
    assert.ok(Math.abs(land.rot - neat.rot) <= RECEIVE.scatterRot + 1e-9)
    if (off > 6 || Math.abs(land.rot - neat.rot) > 4) moved++
  }
  assert.ok(moved > 30, 'most cards should land visibly off their place')
})

test('the player collects the pair after the second card is down, then taps it square from above', () => {
  const neat = { x: 400, y: 600, rot: 3 }
  const land = scatter(neat, 60, mulberry32(4))
  const flight = pitch({ x: 400, y: -80 }, land, mulberry32(5))
  const landedAt = flight[flight.length - 1].t
  const collectAt = landedAt + 700
  const frames = receive(flight, neat, collectAt, mulberry32(6))
  for (const f of frames.filter((f) => f.t >= landedAt && f.t <= collectAt)) {
    assert.deepEqual({ x: f.x, y: f.y, rot: f.rot }, { x: land.x, y: land.y, rot: land.rot })
  }
  const last = frames[frames.length - 1]
  assert.deepEqual({ x: last.x, y: last.y, rot: last.rot, lift: last.lift }, { ...neat, lift: 0 })
  // Two taps, each a press down into the cloth: the pair dips, then comes back up.
  const after = frames.filter((f) => f.t > collectAt)
  const presses = after.filter((f) => f.lift < 0)
  assert.equal(presses.length, 2, 'expected two taps')
  // A tap from above never shoves the cards sideways: during the taps they only close on their place.
  const tapping = after.filter((f) => f.t >= presses[0].t - RECEIVE.tapMs[1])
  const gap = tapping.map((f) => Math.hypot(f.x - neat.x, f.y - neat.y))
  for (let i = 1; i < gap.length; i++) assert.ok(gap[i] <= gap[i - 1] + 1e-9, 'a tap moved the cards away')
  // Each tap straightens them further.
  const off = (f: Frame) => Math.abs(f.rot - neat.rot)
  assert.ok(off(presses[1]) < off(presses[0]))
})

test('no two players tap alike', () => {
  const neat = { x: 400, y: 600, rot: 3 }
  const flight = pitch({ x: 400, y: -80 }, scatter(neat, 60, mulberry32(4)), mulberry32(5))
  const taps = (seed: number) => receive(flight, neat, 2_000, mulberry32(seed)).filter((f) => f.lift < 0).map((f) => [Math.round(f.t), f.lift.toFixed(4)].join())
  assert.notDeepEqual(taps(1), taps(2))
})

test('the dealer keeps no metronome: gaps vary but the deal fits its window', () => {
  const starts = dealSchedule(12, 1_300, 150, mulberry32(3))
  assert.equal(starts.length, 12)
  assert.equal(starts[0], 0)
  const gaps = starts.slice(1).map((s, i) => s - starts[i])
  assert.ok(gaps.every((g) => g > 0))
  assert.ok(new Set(gaps.map((g) => Math.round(g))).size > 6, 'gaps are too even')
  assert.ok(starts[starts.length - 1] <= 1_300)
})

test('each pitch leaves the fingers at its own speed', () => {
  const time = (seed: number) => { const f = pitch({ x: 0, y: -80 }, { x: 0, y: 600, rot: 0 }, mulberry32(seed)); return Math.round(f[f.length - 1].t) }
  assert.ok(new Set([1, 2, 3, 4, 5, 6].map(time)).size >= 4, 'every pitch takes the same time')
})

test('a fold is a light toss: short, low and barely turning', () => {
  const from = { x: 500, y: 700, rot: 0 }
  const aim = { x: 500, y: 300 }
  for (let seed = 1; seed < 40; seed++) {
    const hard = toss(from, aim, { dx: 0.4, dy: -1, speed: 1 }, mulberry32(seed))
    assert.ok(Math.hypot(hard.rest.x - from.x, hard.rest.y - from.y) <= 400 * 0.5, 'thrown too far')
    assert.ok(Math.abs(hard.rest.rot) <= 60, `turned ${hard.rest.rot}`)
    assert.ok(Math.max(...hard.frames.map((f) => f.lift)) <= 0.03, 'thrown too high')
  }
})

test('a fold never slides into the middle of the table', () => {
  const aim = { x: 500, y: 300 }
  for (let seed = 1; seed < 40; seed++) {
    const from = { x: 500 + Math.cos(seed) * 260, y: 300 + Math.sin(seed) * 260, rot: 0 }
    const thrown = toss(from, aim, { dx: 0, dy: -1, speed: 1 }, mulberry32(seed), 180)
    for (const f of thrown.frames) assert.ok(Math.hypot(f.x - aim.x, f.y - aim.y) >= 180 - 1, `into the middle at seed ${seed}`)
  }
})

test('a quiet fold card spins anywhere from barely to a little', () => {
  const from = { x: 500, y: 700, rot: 0 }
  const turns = Array.from({ length: 60 }, (_, seed) =>
    Math.abs(toss(from, { x: 500, y: 300 }, { dx: 0.3, dy: -1, speed: 0.8 }, mulberry32(seed)).rest.rot))
  assert.ok(Math.min(...turns) < 8, 'never barely turns')
  assert.ok(Math.max(...turns) > 25, 'never turns much')
})

test('a wild fold card spins hard', () => {
  const from = { x: 500, y: 700, rot: 0 }
  for (let seed = 1; seed < 20; seed++) {
    const wild = toss(from, { x: 500, y: 300 }, { dx: 0.3, dy: -1, speed: 0.8 }, mulberry32(seed), 0, true)
    assert.ok(Math.abs(wild.rest.rot) >= 90, `wild card turned only ${wild.rest.rot}`)
  }
})

test('at most one card of a fold spins wild, and usually neither', () => {
  const picks = Array.from({ length: 400 }, (_, seed) => wildCard(mulberry32(seed)))
  assert.ok(picks.every((p) => p === -1 || p === 0 || p === 1))
  const none = picks.filter((p) => p === -1).length
  assert.ok(none > 400 * 0.5 && none < 400 * 0.8, `${none} of 400 folds had no wild card`)
  assert.ok(picks.includes(0) && picks.includes(1))
})

test('a fold with no room to slide stays where it is and stays a number', () => {
  const from = { x: 500, y: 450, rot: 2 }
  const thrown = toss(from, { x: 500, y: 300 }, { dx: 0, dy: -1, speed: 1 }, mulberry32(1), 400)
  assert.ok(thrown.frames.every((f) => [f.x, f.y, f.rot, f.lift].every(Number.isFinite)), 'a frame is not a number')
  assert.equal(Math.round(thrown.rest.x), 500)
  assert.equal(Math.round(thrown.rest.y), 450)
})

test('the two cards of a fold part ways a little, not stuck together', () => {
  const from = { x: 500, y: 700, rot: 0 }
  const aim = { x: 500, y: 300 }
  const heading = (r: { rest: { x: number; y: number } }) => Math.atan2(r.rest.x - from.x, from.y - r.rest.y) * (180 / Math.PI)
  const spread = Array.from({ length: 40 }, (_, seed) => {
    const flick = { dx: 0.2, dy: -1, speed: 0.8 }
    const a = toss(from, aim, flick, mulberry32(seed * 2 + 1))
    const b = toss(from, aim, flick, mulberry32(seed * 2 + 2))
    return { angle: Math.abs(heading(a) - heading(b)), reach: Math.abs(Math.hypot(a.rest.x - from.x, a.rest.y - from.y) - Math.hypot(b.rest.x - from.x, b.rest.y - from.y)) }
  })
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  assert.ok(mean(spread.map((s) => s.angle)) > 6, 'the pair heads the same way every time')
  assert.ok(Math.max(...spread.map((s) => s.angle)) <= 30, 'the pair splits apart')
  assert.ok(mean(spread.map((s) => s.reach)) > 12, 'the pair travels the same distance every time')
})
