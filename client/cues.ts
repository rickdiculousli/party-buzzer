/**
 * The cues that are recipes rather than bare samples.
 *
 * A cue named here is rendered by `synth.ts`; a cue that is not falls through
 * to the sample path in `sound.ts`, unchanged. Both kinds coexist on purpose —
 * ninety-three seconds of marimba will never be a recipe.
 *
 * The anchor cues are the hand-tuned WAVs, each wrapped in a `{ file }` layer.
 * That buys the waveform editor without changing a sample of what plays today,
 * because the envelope is deliberately a no-op: no attack and no decay means `schedule`'s first two
 * steps land on the same instant, so gain is at full from the file's first
 * sample; `level: 1` keeps the level *at* full rather than at
 * `GAIN_FLOOR`, which is what an omitted level would mean and would be
 * silence; `sustain` is the file's own length in ms, so the gate never closes
 * early; and the 40ms release runs entirely past the end of the buffer, where
 * there is nothing left to fade. Change `sustain` if you re-cut a file — a layer
 * whose segments are shorter than its file is a truncated cue.
 *
 * `leader` is two layers because it is two sounds: a drop and a buzzer under
 * it, one moment. They were two separate cues fired together until the editor
 * could show them on one timeline — which is the only way to move one against
 * the other and see what you did. Nothing about the sound changed in the
 * merge: both carried the same gain, delay and rate.
 *
 * `gain` is on the layer because this table is now the only place a cue's sound
 * is described. It used to be `--<cue>-snd-gain` in style.css, read through
 * `getComputedStyle` at play time — which made sense when a cue was one sample
 * and its numbers sat beside the movement they were aligned to, and stopped
 * making sense the moment a cue became a list of layers that each already had
 * a `gain` field. A stylesheet is for what things look like. Volume is not.
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
      "gain": 0.8,
      "level": 1,
      "sustain": 216,
      "release": 40
    }
  ],
  "type": [
    {
      "source": "noise",
      "attack": 1,
      "decay": 26,
      "level": 0,
      "sustain": 0,
      "release": 12,
      "gain": 0.15,
      "filter": {
        "type": "highpass",
        "freq": 2400
      }
    },
    {
      "source": "square",
      "freq": 1900,
      "freqTo": 1100,
      "glide": "exp",
      "attack": 1,
      "decay": 20,
      "level": 0,
      "sustain": 0,
      "release": 10,
      "gain": 0.05
    }
  ],
  "award": [
    {
      "source": "sine",
      "freq": 120,
      "freqTo": 38,
      "glide": "exp",
      "attack": 2,
      "decay": 190,
      "level": 0,
      "sustain": 0,
      "release": 60,
      "gain": 1.035
    },
    {
      "source": "noise",
      "attack": 1,
      "decay": 70,
      "level": 0,
      "sustain": 0,
      "release": 30,
      "gain": 0.575,
      "filter": {
        "type": "lowpass",
        "freq": 500
      }
    },
    {
      "source": "sine",
      "freq": 90,
      "freqTo": 40,
      "glide": "exp",
      "attack": 2,
      "decay": 120,
      "level": 0,
      "sustain": 0,
      "release": 40,
      "gain": 0.322,
      "delay": 110
    },
    {
      "source": "sine",
      "freq": 880,
      "attack": 20,
      "decay": 900,
      "level": 0,
      "sustain": 0,
      "release": 500,
      "gain": 0.253,
      "delay": 260
    },
    {
      "source": "sine",
      "freq": 1318,
      "attack": 16,
      "decay": 750,
      "level": 0,
      "sustain": 0,
      "release": 420,
      "gain": 0.115,
      "delay": 300
    }
  ],
  "penalty": [
    {
      "source": "sine",
      "freq": 120,
      "freqTo": 38,
      "glide": "exp",
      "attack": 2,
      "decay": 190,
      "level": 0,
      "sustain": 0,
      "release": 60,
      "gain": 1.035
    },
    {
      "source": "noise",
      "attack": 1,
      "decay": 70,
      "level": 0,
      "sustain": 0,
      "release": 30,
      "gain": 0.575,
      "filter": {
        "type": "lowpass",
        "freq": 500
      }
    },
    {
      "source": "sine",
      "freq": 90,
      "freqTo": 40,
      "glide": "exp",
      "attack": 2,
      "decay": 120,
      "level": 0,
      "sustain": 0,
      "release": 40,
      "gain": 0.322,
      "delay": 110
    },
    {
      "source": "sawtooth",
      "freq": 150,
      "attack": 6,
      "decay": 420,
      "level": 0,
      "sustain": 0,
      "release": 80,
      "gain": 0.3,
      "delay": 260,
      "filter": {
        "type": "lowpass",
        "freq": 900
      }
    },
    {
      "source": "sawtooth",
      "freq": 155,
      "attack": 6,
      "decay": 420,
      "level": 0,
      "sustain": 0,
      "release": 80,
      "gain": 0.3,
      "delay": 260,
      "filter": {
        "type": "lowpass",
        "freq": 900
      }
    }
  ],
  "leader": [
    {
      "source": {
        "file": "/sounds/leader.wav"
      },
      "gain": 0.8,
      "level": 1,
      "sustain": 841,
      "release": 40
    },
    {
      "source": {
        "file": "/sounds/leader2.wav"
      },
      "gain": 0.8,
      "level": 1,
      "sustain": 3040,
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
  'freq', 'freqTo', 'attack', 'decay', 'level', 'sustain', 'release', 'gain', 'delay', 'head',
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
    (l) => (l.delay ?? 0) + (l.attack ?? 0) + (l.decay ?? 0) + (l.sustain ?? 0) + (l.release ?? 0),
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
  if (field === 'level') return Math.min(1, Math.max(0, Number(value.toFixed(2))))
  if (field === 'gain') return Math.max(0, Number(value.toFixed(2)))
  if (field === 'head') return Math.min(Math.max(0, Math.round(value)), Math.max(0, Math.round(maxHead)))
  return Math.max(0, Math.round(value))
}

/**
 * A layer, with an envelope that makes it audible on arrival.
 *
 * A file layer is gated like any other, so one written with no segments is
 * silent (see the `ponytail:` note on `Source`) — the whole-duration `sustain` is
 * the default that stops the front door from handing you a silent layer.
 * `durationMs` is the decoded buffer's real length; zero when nothing is
 * decoded yet, which is a layer you can still see and drag.
 */
export function addLayer(recipe: Recipe, source: Source, durationMs = 0): Recipe {
  const layer: Layer =
    typeof source === 'object'
      ? { source, level: 1, sustain: Math.round(durationMs), release: 40 }
      : { source, freq: 440, attack: 2, decay: 160, level: 0, sustain: 0, release: 40, gain: 0.6 }
  return [...recipe, layer]
}

/** Drop one layer. Order carries no meaning — layers mix simultaneously. */
export function removeLayer(recipe: Recipe, i: number): Recipe {
  return recipe.filter((_, n) => n !== i)
}
