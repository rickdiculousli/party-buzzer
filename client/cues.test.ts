import test from 'node:test'
import assert from 'node:assert/strict'
import { getPath, withOverrides, RECIPES } from './cues.ts'
import type { Recipe } from './synth.ts'

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
