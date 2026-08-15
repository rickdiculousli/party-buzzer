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
  const out = withOverrides(SAMPLE, { 'stamp.9.freq': '100', 'junk': '1' })
  assert.deepEqual(out, SAMPLE)
})

test('every shipped recipe is non-empty', () => {
  for (const [cue, r] of Object.entries(RECIPES)) assert.ok(r.length > 0, `${cue} is empty`)
})
