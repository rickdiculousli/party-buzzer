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
import type { Layer, Recipe, Source } from './synth.ts'

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

/** The recipe for a cue, or nothing if that cue is still a sample. */
export function recipeFor(cue: string): Recipe | undefined {
  return (RECIPES as Record<string, Recipe>)[cue]
}

/**
 * One field written into a copy of the tree.
 *
 * The replacement for `withOverrides`: the harness holds the tree itself now,
 * so an edit is a write rather than an entry in a side map. A path naming a
 * layer that does not exist returns the table it was given — a stale dial must
 * not be able to invent a layer, exactly as the CSS endpoint refuses an unknown
 * property instead of appending it. A *field* the layer omits is allowed
 * through: the canvas draws all four handles whatever the recipe declares.
 */
export function setPath(
  recipes: Record<string, Recipe>,
  path: string,
  value: number,
): Record<string, Recipe> {
  const [cue, index, field] = path.split('.')
  if (!FIELDS.has(field) || !recipes[cue]?.[Number(index)]) return recipes
  const out = structuredClone(recipes)
  ;(out[cue][Number(index)] as Record<string, unknown>)[field] = value
  return out
}

/**
 * How wide the shared axis has to be, in ms: the last instant any layer is
 * still sounding.
 *
 * One axis for the whole cue is the point of the view. Scaling each layer to
 * its own length — which is what the old envelope canvas did — makes two layers
 * of different lengths incomparable, and comparing them is the entire reason
 * for combining two sounds.
 */
export function span(recipe: Recipe): number {
  const ends = recipe.map(
    (l) => (l.delay ?? 0) + (l.attack ?? 0) + (l.decay ?? 0) + (l.hold ?? 0) + (l.release ?? 0),
  )
  return Math.max(1, ...ends)
}

/**
 * A dragged value, made legal.
 *
 * `head` is the one clamp that needs the outside world: it is an offset into a
 * file, so its ceiling is that file's duration, which only the caller holding
 * the buffer knows.
 */
export function clampField(field: NumericField, value: number, maxHead = Infinity): number {
  if (field === 'sustain') return Math.min(1, Math.max(0, Number(value.toFixed(2))))
  if (field === 'gain') return Math.max(0, Number(value.toFixed(2)))
  if (field === 'head') return Math.min(Math.max(0, Math.round(value)), Math.max(0, Math.round(maxHead)))
  return Math.max(0, Math.round(value))
}

/**
 * A layer, with an envelope that makes it audible on arrival.
 *
 * A file layer is gated like any other, so one written with no stages is
 * silent (see the `ponytail:` note on `Source`) — the whole-duration `hold` is
 * the default that stops the front door from handing you a silent layer.
 * `durationMs` is the decoded buffer's real length; zero when nothing is
 * decoded yet, which is a layer you can still see and drag.
 */
export function addLayer(recipe: Recipe, source: Source, durationMs = 0): Recipe {
  const layer: Layer =
    typeof source === 'object'
      ? { source, sustain: 1, hold: Math.round(durationMs), release: 40 }
      : { source, freq: 440, attack: 2, decay: 160, sustain: 0, hold: 0, release: 40, gain: 0.6 }
  return [...recipe, layer]
}

/** Drop one layer. Order carries no meaning — layers mix simultaneously. */
export function removeLayer(recipe: Recipe, i: number): Recipe {
  return recipe.filter((_, n) => n !== i)
}
