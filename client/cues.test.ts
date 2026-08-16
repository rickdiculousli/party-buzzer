import test from 'node:test'
import assert from 'node:assert/strict'
import { getPath, withOverrides, RECIPES } from './cues.ts'
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

test('overrides produce a new table and leave the original alone', () => {
  const out = withOverrides(SAMPLE, { 'stamp.1.freq': '1200' })
  assert.equal(out.stamp[1].freq, 1200)
  assert.equal(SAMPLE.stamp[1].freq, 900, 'the source table was mutated')
})

test('an override that names nothing real is ignored rather than thrown', () => {
  const out = withOverrides(SAMPLE, { 'stamp.9.freq': '100', 'junk': '1', 'stamp.0.nope': '3' })
  assert.deepEqual(out, SAMPLE)
})

// The envelope canvas always draws four handles, whatever the committed recipe
// happens to declare, so a drag has to be able to introduce the field.
test('a field the recipe omits can still be dialled in', () => {
  const out = withOverrides(SAMPLE, { 'stamp.0.hold': '120', 'stamp.0.sustain': '0.4' })
  assert.equal(out.stamp[0].hold, 120)
  assert.equal(out.stamp[0].sustain, 0.4)
  assert.equal(SAMPLE.stamp[0].hold, undefined, 'the source table was mutated')
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
