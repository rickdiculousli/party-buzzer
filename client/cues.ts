/**
 * The cues that are synthesized rather than found.
 *
 * A cue named here is rendered by `synth.ts`; a cue that is not falls through
 * to the sample path in `sound.ts`, unchanged. Both kinds coexist on purpose —
 * ninety-three seconds of marimba will never be a recipe.
 *
 * The block between the markers is machine-written: the harness rewrites it
 * through `POST /__anim/save`, the same way it already rewrites the CSS
 * tunables. Prose lives outside the markers and survives; anything inside is
 * regenerated wholesale, so do not put a comment in there expecting to see it
 * again.
 */
import type { Layer, Recipe } from './synth.ts'

/* cue:recipes — rewritten in place by the harness. Prose lives outside the
   markers; everything between them is machine-written. */
export const RECIPES = {
  "stamp": [
    {
      "source": "noise",
      "attack": 1,
      "decay": 55,
      "gain": 0.5,
      "filter": { "type": "bandpass", "freq": 2600, "freqTo": 1200, "q": 6 }
    },
    {
      "source": "square",
      "freq": 1400,
      "freqTo": 600,
      "glide": "exp",
      "attack": 1,
      "decay": 40,
      "gain": 0.35
    }
  ],
  "leader": [
    {
      "source": "sine",
      "freq": 320,
      "freqTo": 55,
      "glide": "exp",
      "attack": 8,
      "decay": 620,
      "gain": 0.9
    }
  ],
  "leader2": [
    {
      "source": "sawtooth",
      "freq": 180,
      "attack": 6,
      "decay": 120,
      "sustain": 0.7,
      "hold": 2600,
      "release": 280,
      "gain": 0.4,
      "filter": { "type": "bandpass", "freq": 900, "q": 4 }
    }
  ]
} satisfies Record<string, Recipe>
/* /cue:recipes */

/** One numeric field, addressed the way a harness dial addresses it. */
export function getPath(
  recipes: Record<string, Recipe>,
  path: string,
): number | undefined {
  const [cue, index, field] = path.split('.')
  const v = recipes[cue]?.[Number(index)]?.[field as keyof Layer]
  return typeof v === 'number' ? v : undefined
}

/** Every numeric field a dial may address. A path naming anything else is junk. */
export const NUMERIC = [
  'freq', 'freqTo', 'attack', 'decay', 'sustain', 'hold', 'release', 'gain', 'delay', 'head',
] as const satisfies readonly (keyof Layer)[]

export type NumericField = (typeof NUMERIC)[number]

const FIELDS: ReadonlySet<string> = new Set(NUMERIC)

/**
 * The table with the harness's dialled values laid over it.
 *
 * A path naming a layer that does not exist is dropped rather than created: a
 * stale dial must not be able to invent a layer, for the same reason the CSS
 * endpoint refuses an unknown property instead of appending it. A *field* the
 * layer simply omits is allowed through, because the envelope canvas draws all
 * four handles whatever the recipe declares, and a hold drag on a layer with no
 * hold has to be able to give it one.
 */
export function withOverrides(
  recipes: Record<string, Recipe>,
  values: Record<string, string>,
): Record<string, Recipe> {
  const out = structuredClone(recipes)
  for (const [path, raw] of Object.entries(values)) {
    const [cue, index, field] = path.split('.')
    const layer = out[cue]?.[Number(index)]
    if (!layer || !FIELDS.has(field)) continue
    const n = parseFloat(raw)
    if (Number.isFinite(n)) (layer as Record<string, unknown>)[field] = n
  }
  return out
}

/** The recipe for a cue, or nothing if that cue is still a sample. */
export function recipeFor(cue: string): Recipe | undefined {
  return (RECIPES as Record<string, Recipe>)[cue]
}
