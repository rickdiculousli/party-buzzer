# The waveform editor

A DAW view for the sound panel: every layer of a cue on one shared timeline,
the audio drawn behind the envelope that gates it, and layers you add and
remove in the UI rather than by hand-editing `client/cues.ts`.

## Why

The sound workbench shipped an ADSHR envelope canvas. That answered a question
nobody asked. The original complaint was time lost digging through downloaded
sound effects — found sounds, not oscillators — and the tool it produced makes
synthesis draggable while leaving sample trimming as two numeric sliders.

This closes that gap, and the one behind it: recipe layers already support
`{ file }` sources at runtime, so combining two sounds works today, but only
if you open `cues.ts` in an editor and type it. There is no front door.

## What exists to build on

- `client/synth.ts` — `Layer` carries `head` (ms into the file) and the ADSHR
  fields. A file layer has no tail-trim field: its end is the envelope's end.
- `client/cues.ts` — `RECIPES` between machine-written markers; `getPath`;
  `withOverrides`, which this design deletes.
- `client/sound.ts` — `files`, a module-private `Map<string, AudioBuffer>`
  filled by `primeFile`.
- `client/anim/main.tsx` — already loops `live[cue].map(layer => <Envelope>)`,
  so the per-layer rendering shape is correct; only its contents change.
- `client/anim/Envelope.tsx` — 96 lines, absorbed and deleted.
- `vite.config.ts` — `/__anim/save` already accepts `{ css, recipes }` and
  regenerates the `cue:recipes` block wholesale, so the save path itself needs
  no change. The file still gains one new listing route (see The front door).

## Decisions

**Layers point only at adopted files.** A layer may reference a file in
`client/public/sounds/`, never one in `sounds/raw/`. This holds one invariant:
anything a recipe names is servable to the real board, so the harness cannot
show you a cue that goes silent in production. That bug has already happened
once on this codebase. Using a download means adopting it first, which is one
click you were making anyway.

**One shared timeline, stacked tracks.** All of a cue's layers share one
x-axis. Today's `Envelope` scales x to each layer's own length, which makes two
layers of different lengths incomparable — exactly the thing that matters when
combining sounds.

**`welcome` stays on the legacy sample path.** It is a minute-long looping bed
with `loopStart`/`loopEnd`; recipes are one-shots with envelopes, so migrating
it would mean teaching the synth to loop. It is music that runs, not a sound
that fires.

**No layer reordering.** Layers mix simultaneously and array order has no
effect on the sound.

**The picker offers oscillators too.** A source picker is needed for files
regardless, and `recipeDials` already generates freq and glide dials, so
covering the five oscillator sources costs an array literal.

**No tail-trim field.** Cutting a file at 500ms with a 40ms fade is
`hold: 460, release: 40`. The envelope already expresses it.

## Architecture

### State

The harness holds one new state, and `RECIPES` becomes its origin:

```ts
const [draft, setDraft] = useState<Record<string, Recipe>>(() => structuredClone(RECIPES))
```

Every recipe edit — slider, envelope drag, add, remove — mutates `draft`.
Everything downstream reads `draft[cue]` where it reads `live[cue]` today, so
the trigger effect, the per-layer loop, and the priming walk keep their shape.

This replaces the flat-override model, which cannot express structural change.
Override keys are `cue.index.field`; removing layer 0 silently retargets every
key naming layer 1. Stable per-layer ids would fix that at the cost of writing
UI bookkeeping into the committed data. A draft tree avoids both.

Consequences:

- **`withOverrides` is deleted**, with its four tests. `getPath` survives —
  `readDefaults` still seeds "was" values through it.
- **`values` holds only CSS properties again**, so the `cssValues` filter added
  alongside recipe dials is deleted too.
- Recipe dial keys stay `cue.i.field` strings for the dial UI, but they write
  through `setDraft` into the tree instead of accumulating in a map.
- **Reset** is `setDraft(structuredClone(RECIPES))`. Nothing is written until
  Save, so a deleted layer comes back.
- **Save** posts `{ css: values, recipes: draft }` — the endpoint's existing
  shape.

### Drawing the audio

`sound.ts` gains one accessor, `bufferFor(url): AudioBuffer | undefined`, over
the `files` map. Nothing new is fetched: the harness already primes every file
layer at `main.tsx:212`. Peaks come from `getChannelData(0)`.

`peaks(data, width)` reduces a `Float32Array` to one min/max pair per column.
It is pure and lives in `client/peaks.ts`.

### Components

`Envelope.tsx` is deleted, its handle math absorbed.

- **`Layers.tsx`** — owns the shared x-axis for one cue. Span is
  `max(delay + attack + decay + hold + release)` across layers, recomputed as
  you drag. Draws the ruler, stacks the tracks.
- **`Track.tsx`** — one layer: waveform behind when the source is a file,
  envelope overlay in front, both on the shared scale. An oscillator layer is
  the same component without a waveform.

### Interaction

Audacity's clip metaphor, so there is nothing new to learn:

| gesture | field |
| --- | --- |
| drag the track body sideways | `delay` — moves the layer in time |
| drag the waveform's left edge | `head` — slides the audio inside the clip |
| the four envelope handles | `attack`, `decay`/`sustain`, `hold`, `release` |

The body drag and the left-edge drag share a boundary, so the edge wins inside
a fixed hit zone — 6px from the waveform's left edge — and the body takes
everything else. Same rule Audacity uses, and the reason the zone is measured
in pixels rather than milliseconds is that it is a pointing target, not a
duration.

Handles drag as a delta, not to an absolute position, matching `Envelope.tsx`'s
existing behaviour — dragging to absolute makes a handle jump to the cursor on
grab.

Audio past the envelope's end is drawn dimmed rather than clipped away, so the
tail being gated off stays visible and draggable back. That is the reason to
draw a waveform at all.

Clamps: `head` cannot exceed the file's duration; `delay` cannot go negative;
envelope stages cannot go negative.

### The front door

`+ layer` opens a source picker — adopted files, or one of the five
oscillators. Defaults:

- **file:** `sustain: 1`, `hold` = the buffer's real duration, `release: 40`.
  A no-op envelope, so it plays whole the moment it is added. A file layer with
  no envelope stages is silent (see the `ponytail:` note on `Source`), which is
  the footgun this default exists to avoid.
- **oscillator:** a short pluck.

`×` per track removes it. Both are `setDraft` mutations, both undone by Reset.

The picker's list needs `/__snd/adopted`, a new route in `sndLibrary()`
reusing the existing listing code against `OUT` instead of `RAW`. Same
`apply: 'serve'` guard.

## Testing

The arithmetic is extracted pure and tested in Node — the seam that already
worked for `schedule` and `spacedPlan`:

- `peaks(data, width)` — column count, known input to known peaks, silence
  stays flat, width larger than the sample count.
- `span(recipe)` — the shared axis length, including a layer whose `delay`
  pushes it past a longer layer.
- drag delta → field value, with the clamps.
- `addLayer(recipe, source, duration)` / `removeLayer(recipe, i)` — resulting
  shape and defaults, including that a new file layer's envelope covers its
  whole duration.

Everything else is WebAudio and pointer events, which this repo has no way to
test. That leaves the `npm run motion` pass and a `npm run probe` round. **The
probe round is the one that counts:** the harness and the board have now
disagreed twice, and both times the harness looked correct.

Tests are `node:test` and `node:assert/strict`, as everywhere.

## Files

| File | Status | Responsibility |
| --- | --- | --- |
| `client/peaks.ts` | create | `peaks`, pure |
| `client/peaks.test.ts` | create | its tests |
| `client/anim/Layers.tsx` | create | shared axis, ruler, track stack, `+ layer` |
| `client/anim/Track.tsx` | create | one layer: waveform, envelope, drags |
| `client/anim/Envelope.tsx` | delete | absorbed into `Track.tsx` |
| `client/anim/main.tsx` | modify | `draft` state, Save body, reset, dial writes |
| `client/sound.ts` | modify | `bufferFor` |
| `client/cues.ts` | modify | delete `withOverrides`; add `addLayer`/`removeLayer`/`span` |
| `client/cues.test.ts` | modify | drop the `withOverrides` tests, add the new ones |
| `vite.config.ts` | modify | `/__snd/adopted` |
| `client/style.css` | modify | track and ruler chrome, outside the tunables markers |
| `CLAUDE.md` | modify | document the editor |

## Ceilings

Named here so they are deliberate, each with its upgrade path:

- **No zoom.** The axis is the cue's own length. A 40ms click beside a 3s bed
  is cramped; the harness's existing speed slider is the release valve. Add
  zoom when a cue actually needs it.
- **Peaks at draw width, recomputed on resize.** No cached multi-resolution
  pyramid. These files are seconds long, not hours.
- **Mono.** `getChannelData(0)` only. Every file here is `-ac 1` by the adopt
  presets.
- **No snapping, no curve shaping.** Same ceilings `Envelope.tsx` already
  declared.
- **No cross-cue view.** One cue at a time, which is what a scenario shows.
