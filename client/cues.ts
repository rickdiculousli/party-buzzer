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
 * `gain` is on the layer because this table is the only place a cue's sound is
 * described. Reading it from a stylesheet property at play time would make a
 * cue's volume live somewhere other than the layers it belongs to, each of
 * which already has a `gain` field. A stylesheet is for what things look like.
 * Volume is not.
 *
 * The block between the markers is machine-written: the harness rewrites it
 * through `POST /__anim/save`, the same way it already rewrites the CSS
 * tunables. Prose lives outside the markers and survives; anything inside is
 * regenerated wholesale, so do not put a comment in there expecting to see it
 * again.
 */
import type { Cue } from './sound.ts'
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
  ],
  "sketch-turn": [{ "source": "triangle", "freq": 440, "freqTo": 660, "glide": "exp", "attack": 5, "decay": 220, "level": 0, "sustain": 0, "release": 40, "gain": 0.25 }],
  "sketch-yours": [{"source": "triangle", "freq": 660, "freqTo": 990, "glide": "exp", "attack": 5, "decay": 260, "level": 0, "sustain": 0, "release": 40, "gain": 0.216}],
  "sketch-go": [{"source": "square", "freq": 523, "attack": 2, "decay": 140, "level": 0, "sustain": 0, "release": 30, "gain": 0.152}],
  "sketch-miss": [{"source": "sine", "freq": 220, "attack": 1, "decay": 60, "level": 0, "sustain": 0, "release": 15, "gain": 0.365}],
  "sketch-close": [{ "source": "sine", "freq": 740, "freqTo": 700, "glide": "exp", "attack": 2, "decay": 120, "level": 0, "sustain": 0, "release": 20, "gain": 0.25 }],
  "sketch-got": [{"source": "sine", "freq": 880, "freqTo": 1320, "glide": "exp", "attack": 2, "decay": 180, "level": 0, "sustain": 0, "release": 30, "gain": 0.208}],
  "sketch-right": [{"source": "triangle", "freq": 988, "freqTo": 1480, "glide": "exp", "attack": 2, "decay": 300, "level": 0, "sustain": 0, "release": 40, "gain": 0.39}],
  "sketch-hint": [{"source": "sine", "freq": 1175, "attack": 2, "decay": 90, "level": 0, "sustain": 0, "release": 20, "gain": 0.262}],
  "sketch-tick": [{"source": "square", "freq": 1600, "attack": 1, "decay": 25, "level": 0, "sustain": 0, "release": 10, "gain": 0.132}],
  "sketch-all": [{"source": "sawtooth", "freq": 523, "freqTo": 1046, "glide": "exp", "attack": 5, "decay": 400, "level": 0, "sustain": 0, "release": 60, "gain": 0.302}],
  "sketch-timeup": [{"source": "sawtooth", "freq": 330, "freqTo": 165, "glide": "exp", "attack": 5, "decay": 400, "level": 0, "sustain": 0, "release": 60, "gain": 0.321}],
  "sketch-pass": [{"source": "square", "freq": 262, "freqTo": 196, "glide": "exp", "attack": 3, "decay": 250, "level": 0, "sustain": 0, "release": 40, "gain": 0.12}],
  "sketch-over": [{ "source": "triangle", "freq": 392, "freqTo": 784, "glide": "exp", "attack": 10, "decay": 700, "level": 0, "sustain": 0, "release": 80, "gain": 0.3 }],
  "poker-deal": [{"source": "noise", "attack": 90, "decay": 170, "level": 0, "sustain": 0, "release": 20, "gain": 0.213, "filter": {"type": "lowpass", "freq": 320, "freqTo": 220, "q": 0.7}}],
  "poker-tap": [{"source": "sine", "freq": 120, "freqTo": 70, "glide": "exp", "attack": 1, "decay": 36, "level": 0, "sustain": 0, "release": 20, "gain": 0.28}, {"source": "noise", "attack": 1, "decay": 18, "level": 0, "sustain": 0, "release": 8, "gain": 0.12, "filter": {"type": "lowpass", "freq": 600}}],
  "poker-flip": [{"source": "noise", "attack": 180, "decay": 180, "level": 0, "sustain": 0, "release": 20, "gain": 0.173, "filter": {"type": "lowpass", "freq": 300, "freqTo": 300, "q": 0.7}}],
  "poker-chips": [{"source": "noise", "attack": 1, "decay": 16, "level": 0, "sustain": 0, "release": 6, "gain": 0.538, "filter": {"type": "bandpass", "freq": 3300, "q": 5}},{"source": "noise", "attack": 1, "decay": 16, "level": 0, "sustain": 0, "release": 6, "gain": 0.538, "filter": {"type": "bandpass", "freq": 4200, "q": 5}, "delay": 26},{"source": "noise", "attack": 1, "decay": 16, "level": 0, "sustain": 0, "release": 6, "gain": 0.538, "filter": {"type": "bandpass", "freq": 2900, "q": 5}, "delay": 52},{"source": "sine", "freq": 2650, "freqTo": 2550, "glide": "exp", "attack": 1, "decay": 60, "level": 0, "sustain": 0, "release": 20, "gain": 0.0733, "delay": 26}],
  "poker-sweep": [{"source": "noise", "attack": 40, "decay": 220, "level": 0, "sustain": 0, "release": 60, "gain": 0.162, "filter": {"type": "bandpass", "freq": 1800, "freqTo": 1200, "q": 0.7}}],
  "poker-push": [{"source": "noise", "attack": 1, "decay": 16, "level": 0, "sustain": 0, "release": 6, "gain": 0.511, "filter": {"type": "bandpass", "freq": 3300, "q": 5}},{"source": "noise", "attack": 1, "decay": 16, "level": 0, "sustain": 0, "release": 6, "gain": 0.511, "filter": {"type": "bandpass", "freq": 4200, "q": 5}, "delay": 22},{"source": "noise", "attack": 1, "decay": 16, "level": 0, "sustain": 0, "release": 6, "gain": 0.511, "filter": {"type": "bandpass", "freq": 2900, "q": 5}, "delay": 40},{"source": "noise", "attack": 1, "decay": 16, "level": 0, "sustain": 0, "release": 6, "gain": 0.511, "filter": {"type": "bandpass", "freq": 3800, "q": 5}, "delay": 64},{"source": "noise", "attack": 1, "decay": 16, "level": 0, "sustain": 0, "release": 6, "gain": 0.511, "filter": {"type": "bandpass", "freq": 3100, "q": 5}, "delay": 90},{"source": "noise", "attack": 1, "decay": 16, "level": 0, "sustain": 0, "release": 6, "gain": 0.511, "filter": {"type": "bandpass", "freq": 4400, "q": 5}, "delay": 118},{"source": "noise", "attack": 2, "decay": 90, "level": 0, "sustain": 0, "release": 30, "gain": 0.279, "filter": {"type": "lowpass", "freq": 700}}],
  "poker-fold": [{"source": "noise", "attack": 40, "decay": 90, "level": 0, "sustain": 0, "release": 20, "gain": 0.334, "filter": {"type": "lowpass", "freq": 300, "freqTo": 200, "q": 0.7}}],
  "poker-poof": [{"source": "sine", "freq": 900, "freqTo": 1800, "glide": "exp", "attack": 1, "decay": 50, "level": 0, "sustain": 0, "release": 20, "gain": 0.159},{"source": "noise", "attack": 1, "decay": 30, "level": 0, "sustain": 0, "release": 8, "gain": 0.0793, "filter": {"type": "highpass", "freq": 4000}}],
  "poker-check": [{"source": "sine", "freq": 140, "freqTo": 90, "glide": "exp", "attack": 1, "decay": 45, "level": 0, "sustain": 0, "release": 20, "gain": 0.452},{"source": "noise", "attack": 1, "decay": 25, "level": 0, "sustain": 0, "release": 10, "gain": 0.323, "filter": {"type": "lowpass", "freq": 900}},{"source": "sine", "freq": 140, "freqTo": 90, "glide": "exp", "attack": 1, "decay": 45, "level": 0, "sustain": 0, "release": 20, "gain": 0.388, "delay": 110},{"source": "noise", "attack": 1, "decay": 25, "level": 0, "sustain": 0, "release": 10, "gain": 0.258, "filter": {"type": "lowpass", "freq": 900}, "delay": 110}],
  "poker-allin": [{"source": "sine", "freq": 70, "freqTo": 42, "glide": "exp", "attack": 2, "decay": 600, "level": 0, "sustain": 0, "release": 80, "gain": 0.343},{"source": "sawtooth", "freq": 110, "freqTo": 220, "glide": "exp", "attack": 300, "decay": 500, "level": 0, "sustain": 0, "release": 80, "gain": 0.0685, "filter": {"type": "lowpass", "freq": 400, "freqTo": 2000}}],
  "poker-drumroll": [{"source": "noise", "attack": 1400, "decay": 300, "level": 0, "sustain": 0, "release": 60, "gain": 0.703, "filter": {"type": "bandpass", "freq": 180, "q": 1}},{"source": "noise", "attack": 1400, "decay": 300, "level": 0, "sustain": 0, "release": 60, "gain": 0.112, "filter": {"type": "highpass", "freq": 3000}}],
  "poker-win": [{"source": "triangle", "freq": 523, "attack": 3, "decay": 380, "level": 0, "sustain": 0, "release": 60, "gain": 0.227},{"source": "triangle", "freq": 659, "attack": 3, "decay": 380, "level": 0, "sustain": 0, "release": 60, "gain": 0.227, "delay": 70},{"source": "triangle", "freq": 784, "attack": 3, "decay": 380, "level": 0, "sustain": 0, "release": 60, "gain": 0.227, "delay": 140},{"source": "triangle", "freq": 1047, "attack": 3, "decay": 600, "level": 0, "sustain": 0, "release": 80, "gain": 0.252, "delay": 210},{"source": "sine", "freq": 2093, "attack": 3, "decay": 600, "level": 0, "sustain": 0, "release": 80, "gain": 0.063, "delay": 210}],
  "poker-bust": [{"source": "sawtooth", "freq": 196, "attack": 8, "decay": 200, "level": 0, "sustain": 0, "release": 40, "gain": 0.249, "filter": {"type": "lowpass", "freq": 1000}},{"source": "sawtooth", "freq": 185, "attack": 8, "decay": 200, "level": 0, "sustain": 0, "release": 40, "gain": 0.249, "delay": 250, "filter": {"type": "lowpass", "freq": 1000}},{"source": "sawtooth", "freq": 175, "attack": 8, "decay": 200, "level": 0, "sustain": 0, "release": 40, "gain": 0.249, "delay": 500, "filter": {"type": "lowpass", "freq": 1000}},{"source": "sawtooth", "freq": 165, "freqTo": 150, "glide": "exp", "attack": 8, "decay": 700, "level": 0, "sustain": 0, "release": 80, "gain": 0.28, "delay": 750, "filter": {"type": "lowpass", "freq": 1000}}],
  "poker-level": [{"source": "sine", "freq": 1568, "attack": 2, "decay": 700, "level": 0, "sustain": 0, "release": 80, "gain": 0.169},{"source": "sine", "freq": 3920, "attack": 2, "decay": 300, "level": 0, "sustain": 0, "release": 40, "gain": 0.0564},{"source": "sine", "freq": 1568, "attack": 2, "decay": 700, "level": 0, "sustain": 0, "release": 80, "gain": 0.169, "delay": 180},{"source": "sine", "freq": 3920, "attack": 2, "decay": 300, "level": 0, "sustain": 0, "release": 40, "gain": 0.0564, "delay": 180}],
  "poker-tick": [{"source": "sine", "freq": 1400, "freqTo": 1200, "glide": "exp", "attack": 1, "decay": 30, "level": 0, "sustain": 0, "release": 10, "gain": 0.201},{"source": "noise", "attack": 1, "decay": 10, "level": 0, "sustain": 0, "release": 4, "gain": 0.0838, "filter": {"type": "bandpass", "freq": 3000, "q": 3}}],
  "poker-auto": [{"source": "sine", "freq": 247, "freqTo": 196, "glide": "exp", "attack": 2, "decay": 200, "level": 0, "sustain": 0, "release": 30, "gain": 0.2}],
  "poker-puft": [{"source": "noise", "attack": 12, "decay": 110, "level": 0, "sustain": 0, "release": 40, "gain": 0.16, "filter": {"type": "lowpass", "freq": 300}}],
  "poker-nope": [{"source": "square", "freq": 140, "attack": 1, "decay": 70, "level": 0, "sustain": 0, "release": 20, "gain": 0.183, "filter": {"type": "lowpass", "freq": 800}},{"source": "square", "freq": 140, "attack": 1, "decay": 70, "level": 0, "sustain": 0, "release": 20, "gain": 0.183, "delay": 90, "filter": {"type": "lowpass", "freq": 800}}],
  "poker-detent": [{"source": "square", "freq": 2200, "attack": 1, "decay": 10, "level": 0, "sustain": 0, "release": 4, "gain": 0.169}],
  "poker-react": [{"source": "sine", "freq": 600, "freqTo": 1200, "glide": "exp", "attack": 2, "decay": 70, "level": 0, "sustain": 0, "release": 20, "gain": 0.323}],
  "poker-puck": [{"source": "noise", "attack": 10, "decay": 300, "level": 0, "sustain": 0, "release": 40, "gain": 0.173, "filter": {"type": "bandpass", "freq": 900, "q": 0.8}},{"source": "sine", "freq": 520, "attack": 1, "decay": 40, "level": 0, "sustain": 0, "release": 20, "gain": 0.416, "delay": 380},{"source": "noise", "attack": 1, "decay": 20, "level": 0, "sustain": 0, "release": 10, "gain": 0.416, "filter": {"type": "lowpass", "freq": 1500}, "delay": 380}],
} satisfies Partial<Record<Cue, Recipe>>
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
 * The harness holds the tree itself, so an edit is a write rather than an entry
 * in a side map. A path naming a layer that does not exist returns the table it
 * was given — a stale dial must
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
 * its own length makes two layers of different lengths incomparable, and
 * comparing them is the entire reason for combining two sounds.
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
