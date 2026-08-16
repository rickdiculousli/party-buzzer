import test from 'node:test'
import assert from 'node:assert/strict'
import { addLayer, clampField, getPath, RECIPES, removeLayer, setPath, span } from './cues.ts'
import { schedule, type Recipe, type Step } from './synth.ts'

const SAMPLE: Record<string, Recipe> = {
  stamp: [{ source: 'noise', decay: 60 }, { source: 'sine', freq: 900, decay: 40 }],
}

test('a path reads one field out of one layer', () => {
  assert.equal(getPath(SAMPLE, 'stamp.1.freq'), 900)
  assert.equal(getPath(SAMPLE, 'stamp.0.decay'), 60)
  assert.equal(getPath(SAMPLE, 'stamp.0.release'), undefined)
  assert.equal(getPath(SAMPLE, 'nope.0.freq'), undefined)
})

test('every shipped recipe is non-empty', () => {
  for (const [cue, r] of Object.entries(RECIPES)) assert.ok(r.length > 0, `${cue} is empty`)
})

/**
 * The three anchor cues are the hand-tuned WAVs in a one-layer wrapper, and the
 * whole point of that wrapper is that it changes nothing yet. The envelope
 * gates the file, so this is the assertion that catches the two ways it can
 * silently ruin them: a stage list shorter than the audio truncates the cue,
 * and a missing `sustain` collapses the whole thing to `GAIN_FLOOR`.
 *
 * Durations are the real ones, measured off the files in client/public/sounds.
 */
const DURATION_MS: Record<string, number> = {
  stamp: 216,
  leader: 841,
  leader2: 3040,
}

/** The scheduled gain at one instant, walking the steps the way WebAudio does. */
function gainAt(steps: Step[], t: number): number {
  let prev = steps[0]
  for (const s of steps) {
    if (s.t > t) {
      // A `set` in the future holds the previous value; a ramp travels to it.
      if (s.curve === 'set') return prev.value
      const span = s.t - prev.t
      const k = span <= 0 ? 1 : (t - prev.t) / span
      return s.curve === 'lin'
        ? prev.value + (s.value - prev.value) * k
        : prev.value * (s.value / prev.value) ** k
    }
    prev = s
  }
  return prev.value
}

test('each anchor cue is one file layer over its own WAV', () => {
  for (const [cue, ms] of Object.entries(DURATION_MS)) {
    const r = RECIPES[cue as keyof typeof RECIPES]
    assert.equal(r.length, 1, `${cue} is no longer a single layer`)
    assert.deepEqual(r[0].source, { file: `/sounds/${cue}.wav` })
    assert.ok(ms > 0)
  }
})

test('the file envelope holds full gain for the whole file and outlives it', () => {
  for (const [cue, ms] of Object.entries(DURATION_MS)) {
    const [v] = schedule(RECIPES[cue as keyof typeof RECIPES])
    const dur = ms / 1000
    assert.ok(v.stop > dur, `${cue} stops at ${v.stop}s, before its ${dur}s of audio`)
    // Sampled rather than reasoned about: full gain from the first sample to
    // the last, so nothing about the file's own shape is altered.
    for (let i = 0; i <= 40; i++) {
      const t = (dur * i) / 40
      // Not exact: the last sample lands on the hold boundary, and float64 can
      // put it a femtosecond the wrong side of it.
      assert.ok(gainAt(v.gain, t) > 0.999, `${cue} is not at full gain at ${t}s`)
    }
  }
})

test('setPath writes one field and leaves the source table alone', () => {
  const out = setPath(SAMPLE, 'stamp.1.freq', 1200)
  assert.equal(out.stamp[1].freq, 1200)
  assert.equal(SAMPLE.stamp[1].freq, 900, 'the source table was mutated')
})

// The canvas draws every handle whatever the recipe declares, so a drag on a
// layer with no hold has to be able to give it one.
test('setPath can introduce a field the layer omits', () => {
  assert.equal(setPath(SAMPLE, 'stamp.0.hold', 120).stamp[0].hold, 120)
})

test('setPath naming nothing real returns the table unchanged', () => {
  assert.equal(setPath(SAMPLE, 'stamp.9.freq', 1), SAMPLE)
  assert.equal(setPath(SAMPLE, 'stamp.0.nope', 1), SAMPLE)
  assert.equal(setPath(SAMPLE, 'junk', 1), SAMPLE)
})

test('span is the longest layer end, delay included', () => {
  assert.equal(span([{ source: 'sine', attack: 10, decay: 90 }]), 100)
  // The second layer is shorter but starts late enough to finish last.
  assert.equal(
    span([
      { source: 'sine', attack: 10, decay: 90 },
      { source: 'noise', delay: 200, decay: 50 },
    ]),
    250,
  )
  assert.ok(span([]) > 0, 'an empty cue still needs a divisible axis')
})

test('clamps: nothing negative, sustain is a level, head cannot pass the file', () => {
  assert.equal(clampField('attack', -30), 0)
  assert.equal(clampField('hold', 120.6), 121)
  assert.equal(clampField('sustain', 1.4), 1)
  assert.equal(clampField('sustain', -0.2), 0)
  assert.equal(clampField('head', 900, 400), 400)
  assert.equal(clampField('head', 120, 400), 120)
})

test('a new file layer plays whole the moment it is added', () => {
  const out = addLayer([], { file: '/sounds/stamp.wav' }, 216)
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].source, { file: '/sounds/stamp.wav' })
  assert.equal(out[0].sustain, 1, 'no sustain means the layer is silent')
  assert.equal(out[0].hold, 216, 'the envelope must cover the whole file')
})

test('a new oscillator layer is an audible pluck', () => {
  const [l] = addLayer([], 'sine')
  assert.equal(l.source, 'sine')
  assert.ok((l.decay ?? 0) > 0, 'a layer with no stages is silent')
  assert.ok((l.freq ?? 0) > 0)
})

test('addLayer appends without disturbing what was already there', () => {
  const src: Recipe = [{ source: 'noise', decay: 60 }]
  const out = addLayer(src, 'sine')
  assert.equal(out.length, 2)
  assert.deepEqual(out[0], { source: 'noise', decay: 60 })
})

test('removeLayer drops one and copies the rest', () => {
  const src: Recipe = [{ source: 'sine' }, { source: 'noise' }]
  const out = removeLayer(src, 0)
  assert.deepEqual(out, [{ source: 'noise' }])
  assert.equal(src.length, 2, 'the source recipe was mutated')
})
