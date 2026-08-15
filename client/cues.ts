/**
 * The cues that are recipes rather than bare samples.
 *
 * A cue named here is rendered by `synth.ts`; a cue that is not falls through
 * to the sample path in `sound.ts`, unchanged. Both kinds coexist on purpose —
 * ninety-three seconds of marimba will never be a recipe.
 *
 * All three anchor cues are the hand-tuned WAVs, each wrapped in a single
 * `{ file }` layer. That buys the envelope canvas and room for a second layer
 * without changing a sample of what plays today, because the envelope is
 * deliberately a no-op: no attack and no decay means `schedule`'s first two
 * steps land on the same instant, so gain is at full from the file's first
 * sample; `sustain: 1` keeps the sustain level *at* full rather than at
 * `GAIN_FLOOR`, which is what an omitted sustain would mean and would be
 * silence; `hold` is the file's own length in ms, so the gate never closes
 * early; and the 40ms release runs entirely past the end of the buffer, where
 * there is nothing left to fade. Change `hold` if you re-cut a file — a layer
 * whose stages are shorter than its file is a truncated cue.
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
      "source": {
        "file": "/sounds/stamp.wav"
      },
      "sustain": 1,
      "hold": 216,
      "release": 40
    }
  ],
  "leader": [
    {
      "source": {
        "file": "/sounds/leader.wav"
      },
      "sustain": 1,
      "hold": 841,
      "release": 40
    }
  ],
  "leader2": [
    {
      "source": {
        "file": "/sounds/leader2.wav"
      },
      "sustain": 1,
      "hold": 3040,
      "release": 40
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
