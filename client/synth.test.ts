import test from 'node:test'
import assert from 'node:assert/strict'
import { schedule, onset, GAIN_FLOOR, type Recipe } from './synth.ts'

/** A layer with every envelope segment non-zero, so nothing is hidden by a default. */
const FULL: Recipe = [
  { source: 'sine', freq: 400, attack: 20, decay: 80, level: 0.5, sustain: 100, release: 40 },
]

test('an envelope ends at the sum of its segments', () => {
  const [v] = schedule(FULL)
  // 20 + 80 + 100 + 40 = 240ms, in seconds.
  assert.equal(v.stop, 0.24)
  assert.equal(v.gain.at(-1)!.t, 0.24)
})

test('a layer delay pushes its whole envelope later', () => {
  const [v] = schedule([{ ...FULL[0], delay: 60 }])
  assert.equal(v.start, 0.06)
  assert.equal(v.stop, 0.3)
})

test('rate compresses time and lifts pitch together', () => {
  const [slow] = schedule(FULL, 1)
  const [fast] = schedule(FULL, 2)
  assert.equal(fast.stop, slow.stop / 2)
  assert.equal(fast.freq[0].value, slow.freq[0].value * 2)
})

test('a glide reaches its target at the end of the layer', () => {
  const [v] = schedule([{ source: 'sine', freq: 400, freqTo: 100, glide: 'exp', decay: 200 }])
  const last = v.freq.at(-1)!
  assert.equal(last.value, 100)
  assert.equal(last.t, 0.2)
  assert.equal(last.curve, 'exp')
})

test('onset is the earliest attack peak, not the first layer', () => {
  const r: Recipe = [
    { source: 'sine', delay: 100, attack: 10, decay: 50 },
    { source: 'noise', delay: 0, attack: 30, decay: 50 },
  ]
  assert.equal(onset(r), 30)
  assert.equal(onset([]), 0)
})

test('a bare layer is a plucked tone with nothing after the decay', () => {
  const [v] = schedule([{ source: 'sine', freq: 440, decay: 200 }])
  assert.equal(v.start, 0)
  assert.equal(v.stop, 0.2)
  assert.ok(v.gain.every((s) => s.t <= 0.2))
})

test('a zero-length envelope never stops before it starts', () => {
  const [v] = schedule([{ source: 'sine', freq: 440 }])
  assert.ok(v.stop >= v.start)
  assert.ok(v.gain.every((s) => s.t >= v.start))
})

// exponentialRampToValueAtTime throws outright on a target of zero, and a decay
// to silence is the natural thing to write. Every exponential step floors.
test('no exponential step targets zero', () => {
  const r: Recipe = [
    { source: 'sine', freq: 400, attack: 5, decay: 100, level: 0, sustain: 0, release: 50 },
  ]
  for (const v of schedule(r))
    for (const s of [...v.gain, ...v.freq])
      if (s.curve === 'exp') assert.ok(s.value >= GAIN_FLOOR, `exp step at ${s.t} targets ${s.value}`)
})

test('a filter sweep is scheduled alongside the envelope', () => {
  const [v] = schedule([
    { source: 'noise', decay: 100, filter: { type: 'bandpass', freq: 2000, freqTo: 400, q: 8 } },
  ])
  assert.equal(v.filter!.q, 8)
  assert.equal(v.filter!.freq[0].value, 2000)
  assert.equal(v.filter!.freq.at(-1)!.value, 400)
})
