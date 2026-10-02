import test from 'node:test'
import assert from 'node:assert/strict'
import { RECIPES } from '../client/cues.ts'
import type { Recipe } from '../client/synth.ts'
import { STANDARD, TIERS, level } from './loudness.ts'

test('every cue sits on its loudness tier', () => {
  for (const [cue, recipe] of Object.entries(RECIPES as Record<string, Recipe>)) {
    const tier = STANDARD[cue]
    assert.ok(tier, `${cue} has no tier in tools/loudness.ts`)
    if (tier === 'exempt') continue
    const { lufs } = level(recipe)
    assert.ok(Math.abs(lufs - TIERS[tier]) <= 1.5, `${cue} is ${lufs.toFixed(1)} LUFS, its ${tier} tier is ${TIERS[tier]}: npm run loudness -- --apply`)
  }
})
