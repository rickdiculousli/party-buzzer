# Sound workbench

Synthesized cues, a browsable library of collected sounds, and one place to
tune both against the animation they belong to.

## The problem

Four sounds cost a day. Each one was found on Freesound, auditioned in a
browser tab, downloaded, trimmed by hand with `ffmpeg`, re-listened to on the
board, re-trimmed, renamed, and written into a credits table so the licence
trail survived the rename. `client/public/sounds/CREDITS.md` documents that
workflow in full, which is the tell: a process worth writing down by hand is a
process worth not doing by hand.

Two changes attack it from opposite ends.

A synthesized cue never enters that workflow at all. It has no file to find, no
licence to track, no bytes on the wire, and no `ffmpeg` pass — it is thirty
lines of data, and changing it is dragging a handle rather than re-cutting a
download. The three one-shots on the board today (a typewriter click, a
sub-drop, a buzzer) are all squarely inside what a few oscillators do well.

For the sounds that must stay found — `welcome.ogg` is ninety-three seconds of
marimba and will never be a recipe — the workflow gets automated instead of
removed: a holding ground for downloads, a list in the harness, audition
through the live dials, and one button that runs the `ffmpeg` pass and writes
the credits row.

## What this is not

No Freesound API search. No codec matrix. No offline bounce of a mixed cue to a
file. No separate waveform editor page. Layering happens at play time, where
WebAudio does it for free, so there is no muxing stage to build.

## The recipe

A cue is a list of layers. A layer is one sound source with an envelope on it.
This is the whole vocabulary, and it is sized to the three sounds that exist
rather than to synthesis in general:

```ts
export type Source =
  | 'sine' | 'square' | 'sawtooth' | 'triangle'
  | 'noise'
  | { file: string }

export type Layer = {
  source: Source
  /** Hz at the layer's start. Ignored by `noise` and file sources. */
  freq?: number
  /** Hz to glide to, reached at the end of the layer's audible length. */
  freqTo?: number
  /** How the glide travels. `exp` is what a pitch drop actually sounds like. */
  glide?: 'lin' | 'exp'

  /** Envelope, in ms — except `sustain`, which is a level from 0 to 1. */
  attack?: number
  decay?: number
  sustain?: number
  hold?: number
  release?: number

  gain?: number
  /** Offset within the cue: intentional spacing between layers. */
  delay?: number
  /** Milliseconds into the file before playback starts. File sources only. */
  head?: number

  filter?: { type: BiquadFilterType; freq: number; freqTo?: number; q?: number }
}

export type Recipe = Layer[]
```

Every field defaults such that a bare `{ source: 'sine', freq: 440, decay: 200 }`
is a plain 200ms plucked tone: `sustain`, `hold`, and `release` all default to
zero, so a percussive hit is the short spelling and a sustained buzzer is the
long one. The three cues become, roughly, filtered noise at fifteen
milliseconds; a sine gliding an octave and a half down under an exponential
decay; and a sawtooth with a harsh bandpass, held for three seconds and faded.

Two names appear at both levels and mean different things, so they are worth
separating once. A layer's `delay` and `gain` are internal to the cue: where
this layer sits against its siblings, and how it balances against them. The
cue's `--<cue>-snd-delay` and `--<cue>-snd-gain` are external: where the whole
cue sits against the animation, and how loud it is in the room. They compose —
a layer plays at `cueDelay + layerDelay` and at `cueGain × layerGain` — and
they are edited in different places for the reason given under *Where the
numbers live*.

A file layer is what makes the collected library usable the same way. Its
envelope multiplies the sample rather than an oscillator, which means a found
buzzer can sit underneath a synthesized sub-drop as a second entry in an array,
mixed live, with no encoding step between authoring it and hearing it.

## Onset, and why ordering breaks today

`playSpaced` in `client/sound.ts` reserves a slot per moment and passes it to
`play()` as `offsetMs`, which then computes `t0 = currentTime + (delay + offsetMs) / 1000`.
The per-cue `--<cue>-snd-delay` is added on top of the slot, so two cues in one
run with different delays do not start `--mark-stagger` apart.

Start times are the smaller half of the problem. What the ear registers as the
moment is the attack, not the start. A sample with dead air on its front is
heard late even when it starts on time, and so is a synth layer with a sixty
millisecond attack. The current code has no concept of this — `head` exists
precisely because the problem was being solved by hand, once per file.

Every cue gets an **onset**: how long after its start you actually hear it.

```ts
export function onset(r: Recipe): number {
  return r.length ? Math.min(...r.map((l) => (l.delay ?? 0) + (l.attack ?? 0))) : 0
}
```

It is derived, never dialled, so it cannot drift out of step with the sound it
describes. For a cue that is still a sample it is zero by construction, because
trimming dead air off the front is exactly what `head` already does.

`playSpaced` then spaces slots by *onset* time rather than start time, and
schedules each cue at `slot − onset`. Two things follow. Because today's
samples all have onset zero, this is a no-op on current behaviour and only
begins to matter when a synth cue joins a run — which is the safe shape for a
change to a working board. And when the lead available is shorter than the
onset, the schedule clamps to now and the cue is simply late, exactly as it
would be today.

`delay` keeps its power to reorder, untouched. The distinction the two knobs
draw is the point: `delay` is an offset you asked for, `onset` is latency you
did not.

**Ceiling.** Onset is measured to the envelope's peak. For a long swell the ear
places the moment somewhere before the peak, so a slow-attack cue will read
slightly late. Worth weighting only if a cue ever wants a swell; a
`ponytail:` comment names it.

## Engine

`client/synth.ts` splits at the seam that makes it testable without a browser:

```ts
export type Step = { t: number; value: number; curve: 'set' | 'lin' | 'exp' }
export type Voice = {
  source: Source
  start: number          // seconds, relative to the cue's start
  stop: number
  head: number           // seconds into the file; file sources only
  freq: Step[]
  gain: Step[]
  filter?: { type: BiquadFilterType; q: number; freq: Step[] }
}

export function schedule(recipe: Recipe, rate?: number): Voice[]
export function render(ctx: AudioContext, voices: Voice[], t0: number, gain: number): void
```

`schedule` is pure arithmetic over the recipe and returns everything in seconds
relative to the cue's own start, so `render` only ever adds `t0`. `rate`
multiplies every frequency and divides every time, which is the same
resampling relationship `playbackRate` gives a sample — so the harness dropping
to 0.1× slows and lowers a synthesized cue exactly as it already does a
recorded one.

Noise is one lazily created white-noise buffer, looped and shared by every
layer that asks for it.

**Ceiling.** White only. Pink and brown are a filter away if a recipe ever
wants them.

**Sharp edge worth a test.** `exponentialRampToValueAtTime` throws on a target
of zero, and an exponential glide or decay to silence is the natural thing to
write. Every exponential step floors at `1e-4`.

## Wiring into `sound.ts`

`play()` gains one branch at the top: if the cue has a recipe, render it;
otherwise take the existing buffer path unchanged. One `Cue` type, one call
site, no branching anywhere in `Board`, `Host`, or `Player`.

The division of numbers holds the line the CSS block already draws. `delay` and
`gain` stay as `--<cue>-snd-*` custom properties, because those describe the
sound's relationship to the movement and belong beside the movement. `head`,
`cut`, and `rate` remain sample-only; a recipe's length is its envelopes, and
its per-layer `head` is where a file layer's trim lives.

The legacy sample path deletes itself the day every cue is a recipe. Converting
the three one-shots to one-layer file recipes is a small cleanup available at
that point, deliberately not required by this spec — the board works today and
nothing here needs to risk that to prove itself.

## Where the numbers live

Recipes go in `client/cues.ts`, between markers, in the same discipline the CSS
block already uses:

```ts
/* cue:recipes — rewritten in place by the harness. Prose lives outside the
   markers; everything between them is machine-written. */
export const RECIPES = { ... } satisfies Record<string, Recipe>
/* /cue:recipes */
```

Save extends the existing endpoint rather than adding a second one. The body of
`POST /__anim/save` becomes `{ css: {...}, recipes: {...} }`; the CSS half keeps
its current line-matching regex, and the recipes half regenerates the marked
block from `JSON.stringify(recipes, null, 2)`. Quoted keys are valid TypeScript,
the repo has no formatter to fight with, and comments outside the markers
survive. The endpoint keeps `apply: 'serve'`, so there is still no production
path in which a request rewrites a source file. It keeps its name too — the
`anim:tunables` marker and the `/__anim/save` path are both documented in
`CLAUDE.md`, and renaming them buys nothing.

## The library

`sounds/raw/` at the repo root is the holding ground: gitignored, arbitrarily
messy, the place a download lands. Three dev-only routes serve it.

- `GET /__snd/library` lists the audio files with name, size, and mtime.
- `GET /__snd/raw/<name>` serves one, so the harness can decode and audition it.
- `POST /__snd/adopt` runs the `ffmpeg` pass and promotes one into the project.

Adopt takes the file, an output name, a preset, and the trim and rate currently
dialled in. It writes the result to `client/public/sounds/`, appends the row to
`CREDITS.md` with the exact command it ran, and returns that command so it is
visible rather than implied. The dials reset to neutral afterward, which is the
convention `CREDITS.md` already states: what was dialled in is baked into the
file, and the knobs start again from a sample that already sounds right.

Two presets, matching the reasoning already written in that file and no more:

- **one-shot** — trim to the dialled head and cut, 40ms fade out to match the
  release `play()` would have applied, mono, 44.1kHz, uncompressed PCM. Rate,
  when it is not 1, is `asetrate` plus `aresample`, so speed and pitch move
  together exactly as they do at runtime.
- **bed** — `-c:a libopus -b:a 64k -ac 1`.

`ffmpeg` is invoked through `child_process` and is never an npm dependency. The
endpoint reports plainly when it is not on `PATH` rather than failing
mysteriously. (It is present on this machine at 8.1.2.)

Input is untrusted the moment a path crosses an HTTP boundary, dev-only or not.
Names are reduced to a basename, the resolved path must sit inside `sounds/raw/`,
and an output name must match `/^[a-z0-9-]+\.(wav|ogg)$/`. Both checks are pure
functions, tested from Node without spawning anything.

**Ceiling.** Adopt processes one input file. Muxing several into one is not
built, because layers already mix at play time; if a baked mix is ever genuinely
needed it is an `OfflineAudioContext` render, not an `ffmpeg` graph.

## Harness

A second panel in `/anim.html`, beside Motion rather than replacing it. Sound
tuned in isolation from the movement is the exact mistake the motion harness
was built to avoid, so this reuses its stage, its speed scaling, its retrigger
and loop, and its Save.

`Dial` today addresses a CSS custom property by name. It gains a second shape
addressing a recipe path — `{ patch: 'stamp.1.decay', ... }` — so the existing
slider rendering, origin markers, dirty state, and Save flow all work on synth
fields without knowing they are not CSS.

The one genuinely new piece of UI is a small canvas per layer showing the
envelope, with draggable handles for attack, the decay-to-sustain corner, the
end of hold, and the end of release. Horizontal drag is time, vertical drag on
the sustain corner is level. Everything else in the panel is a range input.

The library appears in the same panel: the list from `/__snd/library`, a button
per file that auditions it *through the current dials* so what you hear is the
trimmed version rather than the raw download, and an adopt control that names
the cue and picks the preset.

The harness stays dev-only by construction. `anim.html` is still absent from
`build.rollupOptions.input`, so none of this is emitted by `npm run build`.

Two existing rules carry over unchanged, and now cover recipes as well as CSS.
Never restate a value in a scenario, because a scenario carrying its own
duration is tuning a copy. And never inline a number the harness cannot reach.

## Testing

`client/synth.test.ts`, `node:test` and `node:assert/strict` only, against
`schedule` and `onset` — no WebAudio in Node, and none needed.

- An envelope's last gain step lands at `delay + attack + decay + hold + release`.
- `rate` compresses time and lifts pitch together: at 2, every `t` halves and
  every frequency doubles.
- `onset` is the earliest layer's attack peak, which is not necessarily the
  first layer in the array.
- A zero-length envelope emits no step whose `stop` precedes its `start`.
- No exponential step targets zero.

Two more against the pure halves of the library middleware: a name escaping
`sounds/raw/` is refused, and the one-shot preset builds the `ffmpeg` argument
list the credits row claims it does.

`client/sound.test.ts` is untouched. `playSpaced`'s onset change is covered by
the `onset` tests plus one direct check that a cue with a non-zero onset is
scheduled earlier than its slot by exactly that much.

## Build order

Each step leaves the board working.

1. `synth.ts` — `schedule`, `render`, `onset`, and their tests. Recipes for the
   three one-shots in `cues.ts`. `play()` resolves recipe-or-sample. Auditioned
   through the existing harness trigger, since scenarios already fire cues.
2. Onset-aware `playSpaced`, plus its test.
3. The harness sound panel: recipe dials, the envelope canvas, recipes in Save.
4. The library: `sounds/raw/` gitignored, the list and serve routes, audition.
5. File-source layers, adopt, and the `CREDITS.md` append.

Steps 1 and 2 alone answer the ordering problem and remove the reason to visit
Freesound for a click or a buzz. Steps 4 and 5 are what make the sounds that
must stay found cheap to keep.
