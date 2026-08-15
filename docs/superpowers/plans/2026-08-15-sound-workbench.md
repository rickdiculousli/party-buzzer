# Sound Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-cut sample hunting with synthesized cues authored as data, make ordering follow the attack the ear hears rather than the start time, and turn the manual Freesound-to-`CREDITS.md` workflow into a browsable library with a one-click `ffmpeg` pass.

**Architecture:** A cue is a `Recipe` — an array of layers, each one source plus an envelope. `client/synth.ts` splits at a pure/impure seam: `schedule(recipe, rate)` is arithmetic returning `Voice[]` in seconds and is tested in Node with no WebAudio, while `render(ctx, voices, t0, gain)` is the only part that touches the browser. `play()` in `client/sound.ts` gains one branch — recipe if there is one, existing buffer path otherwise — so no surface changes. The `/anim.html` harness grows a second panel whose dials address recipe paths instead of CSS properties, reusing its existing slider, origin-marker, dirty-state and Save machinery. Library and adopt are dev-only Vite middleware with every non-trivial decision (path safety, output naming, `ffmpeg` argument construction) pushed into pure functions in `tools/sndlib.ts`.

**Tech Stack:** Native TypeScript on Node 26.7.0 (no server build step), Preact, Vite 6 dev middleware, WebAudio, `node:test` + `node:assert/strict`, `ffmpeg` via `child_process` (never an npm dependency).

**Spec:** `docs/superpowers/specs/2026-08-15-sound-workbench-design.md`

## Global Constraints

- **Node 26.7.0, pinned via mise.** Relative imports in server/tool code carry `.ts` extensions. No `enum`, no `namespace`, no constructor parameter properties.
- **No CDN, no remote assets, anywhere.** Party WiFi has no route to the internet.
- **Runtime dependencies are exactly `ws` and `qrcode`;** the client is `preact`. This plan adds **no** runtime dependency. `ffmpeg` is a machine binary invoked through `child_process`, never a package.
- **Tests use `node:test` and `node:assert/strict` only.** No frameworks, no fixtures.
- **Deliberate simplifications carry a `ponytail:` comment** naming the ceiling and the upgrade path.
- **`npm start` serves `dist/`.** A client change is invisible until `npm run build`. The harness is dev-only: `anim.html` stays out of `build.rollupOptions.input`.
- **Dev-only middleware keeps `apply: 'serve'`,** so no production path lets a request rewrite a source file or spawn a process.
- **Never restate a tunable value in a scenario, and never inline a number into an anchor keyframe.** Both rules now cover recipe fields as well as CSS.
- Exponential WebAudio ramps never target zero: the floor is `1e-4`.
- Run the full suite with `npm test`; a single file with `node --test <path>`.

**One deviation from the spec, deliberate:** the spec's harness section shows a dial shaped `{ patch: 'stamp.1.decay', ... }`. That literal is left over from the earlier name for a recipe. This plan uses `{ recipe: 'stamp.1.decay', ... }` throughout, matching the vocabulary the rest of the spec settled on.

---

## File Structure

| File | Status | Responsibility |
| --- | --- | --- |
| `client/synth.ts` | create | `Source`, `Layer`, `Recipe`, `Step`, `Voice`; `schedule`, `onset` (pure), `render` (WebAudio) |
| `client/synth.test.ts` | create | Tests for `schedule` and `onset` |
| `client/cues.ts` | create | The `RECIPES` table between `cue:recipes` markers, plus `getPath` / `withOverrides` |
| `client/cues.test.ts` | create | Tests for `getPath` / `withOverrides` |
| `client/sound.ts` | modify | `play()` resolves recipe-or-sample; `spacedPlan` (pure) + onset-aware `playSpaced` |
| `client/sound.test.ts` | modify | Add `spacedPlan` tests; existing `parseTune` tests untouched |
| `client/anim/scenarios.tsx` | modify | `Dial` gains a recipe shape; `recipeDials()` builder |
| `client/anim/main.tsx` | modify | Recipe dials, envelope canvas, library panel, `{ css, recipes }` save body |
| `client/anim/Envelope.tsx` | create | The one genuinely new control: a draggable envelope canvas |
| `client/style.css` | modify | Styles for the envelope canvas and library list (outside the tunables markers) |
| `vite.config.ts` | modify | `animSave` takes `{ css, recipes }`; new `sndLibrary()` plugin |
| `tools/sndlib.ts` | create | Pure helpers: path safety, output-name validation, `ffmpeg` argv, credits row |
| `tools/sndlib.test.ts` | create | Tests for the above |
| `package.json` | modify | Test glob gains `'tools/*.test.ts'` |
| `.gitignore` | modify | `sounds/raw/` |
| `client/public/sounds/CREDITS.md` | modify | Appended to by adopt |
| `CLAUDE.md` | modify | Document the sound panel and the library holding ground |

---

### Task 1: The synth engine's pure half

**Files:**
- Create: `client/synth.ts`
- Test: `client/synth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Source`, `type Layer`, `type Recipe`, `type Step`, `type Voice`, `function schedule(recipe: Recipe, rate?: number): Voice[]`, `function onset(r: Recipe): number`, `const GAIN_FLOOR = 1e-4`.

Everything in `Layer` is milliseconds except `sustain` (a 0–1 level), `gain` (a multiplier) and `freq`/`freqTo` (Hz). Everything in `Voice` and `Step` is **seconds**, relative to the cue's own start, because that is the unit WebAudio wants and converting once at the boundary beats converting at every call site. `onset` is the exception and returns **milliseconds**, because its only consumer is `playSpaced`, which works in milliseconds.

- [ ] **Step 1: Write the failing tests**

Create `client/synth.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { schedule, onset, GAIN_FLOOR, type Recipe } from './synth.ts'

/** A layer with every envelope stage non-zero, so nothing is hidden by a default. */
const FULL: Recipe = [
  { source: 'sine', freq: 400, attack: 20, decay: 80, sustain: 0.5, hold: 100, release: 40 },
]

test('an envelope ends at the sum of its stages', () => {
  const [v] = schedule(FULL)
  // 20 + 80 + 100 + 40 = 240ms, in seconds.
  assert.equal(v.stop, 0.24)
  assert.equal(v.gain.at(-1)!.t, 0.24)
})

test('a layer delay pushes its whole envelope later', () => {
  const [v] = schedule([{ ...FULL[0], delay: 60 }])
  assert.equal(v.start, 0.06)
  assert.equal(v.stop, 0.3)
})

test('rate compresses time and lifts pitch together', () => {
  const [slow] = schedule(FULL, 1)
  const [fast] = schedule(FULL, 2)
  assert.equal(fast.stop, slow.stop / 2)
  assert.equal(fast.freq[0].value, slow.freq[0].value * 2)
})

test('a glide reaches its target at the end of the layer', () => {
  const [v] = schedule([{ source: 'sine', freq: 400, freqTo: 100, glide: 'exp', decay: 200 }])
  const last = v.freq.at(-1)!
  assert.equal(last.value, 100)
  assert.equal(last.t, 0.2)
  assert.equal(last.curve, 'exp')
})

test('onset is the earliest attack peak, not the first layer', () => {
  const r: Recipe = [
    { source: 'sine', delay: 100, attack: 10, decay: 50 },
    { source: 'noise', delay: 0, attack: 30, decay: 50 },
  ]
  assert.equal(onset(r), 30)
  assert.equal(onset([]), 0)
})

test('a bare layer is a plucked tone with nothing after the decay', () => {
  const [v] = schedule([{ source: 'sine', freq: 440, decay: 200 }])
  assert.equal(v.start, 0)
  assert.equal(v.stop, 0.2)
  assert.ok(v.gain.every((s) => s.t <= 0.2))
})

test('a zero-length envelope never stops before it starts', () => {
  const [v] = schedule([{ source: 'sine', freq: 440 }])
  assert.ok(v.stop >= v.start)
  assert.ok(v.gain.every((s) => s.t >= v.start))
})

// exponentialRampToValueAtTime throws outright on a target of zero, and a decay
// to silence is the natural thing to write. Every exponential step floors.
test('no exponential step targets zero', () => {
  const r: Recipe = [
    { source: 'sine', freq: 400, attack: 5, decay: 100, sustain: 0, hold: 0, release: 50 },
  ]
  for (const v of schedule(r))
    for (const s of [...v.gain, ...v.freq])
      if (s.curve === 'exp') assert.ok(s.value >= GAIN_FLOOR, `exp step at ${s.t} targets ${s.value}`)
})

test('a filter sweep is scheduled alongside the envelope', () => {
  const [v] = schedule([
    { source: 'noise', decay: 100, filter: { type: 'bandpass', freq: 2000, freqTo: 400, q: 8 } },
  ])
  assert.equal(v.filter!.q, 8)
  assert.equal(v.filter!.freq[0].value, 2000)
  assert.equal(v.filter!.freq.at(-1)!.value, 400)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test client/synth.test.ts`
Expected: FAIL — `Cannot find module './synth.ts'`.

- [ ] **Step 3: Write the pure half of `client/synth.ts`**

```ts
/**
 * Cues as data. A cue is a list of layers; a layer is one source with an
 * envelope on it. That is the whole vocabulary, and it is sized to the three
 * sounds on the board rather than to synthesis in general.
 *
 * The file splits at the only seam that matters: `schedule` is arithmetic and
 * runs anywhere, `render` is the WebAudio half. Everything worth getting wrong
 * is on the arithmetic side, which is why the tests need no browser.
 */

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

export type Step = { t: number; value: number; curve: 'set' | 'lin' | 'exp' }
export type Voice = {
  source: Source
  /** Seconds, relative to the cue's start. `render` only ever adds `t0`. */
  start: number
  stop: number
  /** Seconds into the file. File sources only; zero for everything else. */
  head: number
  freq: Step[]
  gain: Step[]
  filter?: { type: BiquadFilterType; q: number; freq: Step[] }
}

/**
 * The quietest an exponential ramp may aim for.
 *
 * `exponentialRampToValueAtTime` throws on a target of zero, and a decay to
 * silence is the obvious thing to write. -80dB is inaudible, so flooring costs
 * nothing and removes a whole class of runtime exception.
 */
export const GAIN_FLOOR = 1e-4

const ms = (v: number | undefined, rate: number) => (v ?? 0) / 1000 / rate

/**
 * A recipe as instructions, in seconds relative to the cue's own start.
 *
 * `rate` is one resampling knob, exactly as `playbackRate` is for a sample: it
 * multiplies every frequency and divides every time, so the harness at 0.1x
 * slows and lowers a synthesized cue the same way it already does a recorded
 * one.
 */
export function schedule(recipe: Recipe, rate = 1): Voice[] {
  const r = Math.max(0.05, rate)
  return recipe.map((l) => {
    const start = ms(l.delay, r)
    const attack = ms(l.attack, r)
    const decay = ms(l.decay, r)
    const hold = ms(l.hold, r)
    const release = ms(l.release, r)
    const stop = start + attack + decay + hold + release

    const peak = Math.max(l.gain ?? 1, GAIN_FLOOR)
    const level = Math.max(peak * (l.sustain ?? 0), GAIN_FLOOR)

    const gain: Step[] = [{ t: start, value: GAIN_FLOOR, curve: 'set' }]
    const at = (t: number, value: number, curve: Step['curve']) => gain.push({ t, value, curve })
    at(start + attack, peak, 'lin')
    at(start + attack + decay, level, 'exp')
    at(start + attack + decay + hold, level, 'set')
    at(stop, GAIN_FLOOR, 'exp')

    const freq: Step[] = []
    if (l.freq !== undefined) {
      freq.push({ t: start, value: l.freq * r, curve: 'set' })
      if (l.freqTo !== undefined)
        freq.push({ t: stop, value: l.freqTo * r, curve: l.glide === 'exp' ? 'exp' : 'lin' })
    }

    const f = l.filter
    const filter = f && {
      type: f.type,
      q: f.q ?? 1,
      freq: [
        { t: start, value: f.freq * r, curve: 'set' as const },
        ...(f.freqTo === undefined
          ? []
          : [{ t: stop, value: f.freqTo * r, curve: 'exp' as const }]),
      ],
    }

    return { source: l.source, start, stop, head: ms(l.head, r), freq, gain, filter }
  })
}

/**
 * How long after a cue's start you actually hear it.
 *
 * Derived, never dialled, so it cannot drift out of step with the sound it
 * describes. For a cue that is still a sample it is zero by construction —
 * trimming dead air off the front is exactly what `head` already does.
 *
 * ponytail: measured to the envelope's peak. For a long swell the ear places
 * the moment somewhere before the peak, so a slow-attack cue reads slightly
 * late. Weight it only if a cue ever wants a swell.
 */
export function onset(r: Recipe): number {
  return r.length ? Math.min(...r.map((l) => (l.delay ?? 0) + (l.attack ?? 0))) : 0
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test client/synth.test.ts`
Expected: PASS, nine tests.

Two of them are worth reading twice if they fail. `exp` steps must land at or above `GAIN_FLOOR` even when `sustain` is 0 — that is the `Math.max(..., GAIN_FLOOR)` on `level`. And `stop >= start` for an all-defaults layer holds only because every stage falls back to zero.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean. `BiquadFilterType` is a DOM type but erased at runtime, so importing this file in Node is fine.

- [ ] **Step 6: Commit**

```bash
git add client/synth.ts client/synth.test.ts
git commit -m "feat: cues as recipes — schedule and onset, testable without a browser"
```

---

### Task 2: Rendering, the recipe table, and `play()` resolving either

**Files:**
- Modify: `client/synth.ts` (append `render`)
- Create: `client/cues.ts`, `client/cues.test.ts`
- Modify: `client/sound.ts:108-148` (`play`)

**Interfaces:**
- Consumes: `schedule`, `Voice`, `Recipe`, `Source`, `GAIN_FLOOR` from Task 1.
- Produces: `function render(ctx: AudioContext, voices: Voice[], t0: number, gain: number, buffers?: Map<string, AudioBuffer>): void`; `const RECIPES: Record<string, Recipe>`; `function recipeFor(cue: string): Recipe | undefined`; `function getPath(recipes, path): number | undefined`; `function withOverrides(recipes, values): Record<string, Recipe>`; `PlayOpts` gains `recipe?: Recipe`.

- [ ] **Step 1: Write the failing tests for the recipe table's pure helpers**

Create `client/cues.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test client/cues.test.ts`
Expected: FAIL — `Cannot find module './cues.ts'`.

- [ ] **Step 3: Write `client/cues.ts`**

The three recipes below are honest starting points, not final values — dialling them is what Task 4 exists for. Write them exactly as given so the harness has something to open.

```ts
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
import type { Recipe } from './synth.ts'

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
  const v = recipes[cue]?.[Number(index)]?.[field as keyof Recipe]
  return typeof v === 'number' ? v : undefined
}

/**
 * The table with the harness's dialled values laid over it.
 *
 * A path naming a layer or field that does not exist is dropped rather than
 * created: a stale dial must not be able to invent a layer, for the same reason
 * the CSS endpoint refuses an unknown property instead of appending it.
 */
export function withOverrides(
  recipes: Record<string, Recipe>,
  values: Record<string, string>,
): Record<string, Recipe> {
  const out = structuredClone(recipes)
  for (const [path, raw] of Object.entries(values)) {
    const [cue, index, field] = path.split('.')
    const layer = out[cue]?.[Number(index)]
    if (!layer || !field || getPath(recipes, path) === undefined) continue
    const n = parseFloat(raw)
    if (Number.isFinite(n)) (layer as Record<string, unknown>)[field] = n
  }
  return out
}

/** The recipe for a cue, or nothing if that cue is still a sample. */
export function recipeFor(cue: string): Recipe | undefined {
  return (RECIPES as Record<string, Recipe>)[cue]
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test client/cues.test.ts`
Expected: PASS, four tests.

- [ ] **Step 5: Append `render` to `client/synth.ts`**

```ts
/* --- the WebAudio half ---------------------------------------------------
   Nothing below is tested in Node, and nothing below decides anything: it
   walks the steps `schedule` already worked out. Any logic that creeps in
   here belongs above the line instead. */

let noise: AudioBuffer | null = null

/**
 * One second of white noise, made once and shared.
 *
 * ponytail: white only. Pink and brown are a filter away if a recipe wants
 * them.
 */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise?.sampleRate === ctx.sampleRate) return noise
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  noise = buf
  return buf
}

function apply(param: AudioParam, steps: Step[], t0: number): void {
  for (const s of steps) {
    const t = t0 + s.t
    if (s.curve === 'set') param.setValueAtTime(s.value, t)
    else if (s.curve === 'lin') param.linearRampToValueAtTime(s.value, t)
    else param.exponentialRampToValueAtTime(Math.max(s.value, GAIN_FLOOR), t)
  }
}

/**
 * Play what `schedule` planned, starting at `t0` on the context's clock.
 *
 * `buffers` supplies the decoded audio for `{ file }` sources; a file source
 * with nothing decoded for it is skipped rather than thrown, on the same
 * principle as `play()` — a missed sound is never worth an exception on the one
 * screen the whole room is watching.
 */
export function render(
  ctx: AudioContext,
  voices: Voice[],
  t0: number,
  gain: number,
  buffers?: Map<string, AudioBuffer>,
): void {
  for (const v of voices) {
    let node: OscillatorNode | AudioBufferSourceNode
    if (typeof v.source === 'object') {
      const buf = buffers?.get(v.source.file)
      if (!buf) continue
      const src = ctx.createBufferSource()
      src.buffer = buf
      node = src
    } else if (v.source === 'noise') {
      const src = ctx.createBufferSource()
      src.buffer = noiseBuffer(ctx)
      src.loop = true
      node = src
    } else {
      const osc = ctx.createOscillator()
      osc.type = v.source
      apply(osc.frequency, v.freq, t0)
      node = osc
    }

    const amp = ctx.createGain()
    amp.gain.setValueAtTime(GAIN_FLOOR, t0 + v.start)
    apply(amp.gain, v.gain, t0)

    let tail: AudioNode = amp
    if (v.filter) {
      const biq = ctx.createBiquadFilter()
      biq.type = v.filter.type
      biq.Q.value = v.filter.q
      apply(biq.frequency, v.filter.freq, t0)
      amp.connect(biq)
      tail = biq
    }

    const out = ctx.createGain()
    out.gain.value = gain
    node.connect(amp)
    tail.connect(out).connect(ctx.destination)

    if (node instanceof AudioBufferSourceNode) node.start(t0 + v.start, v.head)
    else node.start(t0 + v.start)
    node.stop(t0 + v.stop)
  }
}
```

- [ ] **Step 6: Branch `play()` in `client/sound.ts`**

Add the imports at the top of the file, beside the existing ones:

```ts
import { recipeFor } from './cues.ts'
import { onset, render, schedule, type Recipe } from './synth.ts'
```

Widen the cue type so a recipe-only cue does not have to have a file:

```ts
export type Cue = 'stamp' | 'leader' | 'leader2' | 'welcome'

const FILES: Partial<Record<Cue, string>> = {
  stamp: '/sounds/stamp.wav',
  leader: '/sounds/leader.wav',
  leader2: '/sounds/leader2.wav',
  welcome: '/sounds/welcome.ogg',
}
```

`load()` then needs a guard, because `FILES[cue]` can now be undefined:

```ts
function load(cue: Cue): Promise<AudioBuffer> {
  const held = loading.get(cue)
  if (held) return held
  const url = FILES[cue]
  if (!url) return Promise.reject(new Error(`${cue} has no file`))
  const job = fetch(url)
```

Add the override to `PlayOpts`:

```ts
  /** The harness's dialled recipe, standing in for the committed one. */
  recipe?: Recipe
```

Then put one branch at the top of `play()`, immediately after the destructure and before `const buf = buffers.get(cue)`:

```ts
export function play(
  cue: Cue,
  { scope, rateScale = 1, offsetMs = 0, recipe }: PlayOpts = {},
): void {
  const r = recipe ?? recipeFor(cue)
  if (r) {
    const ac = unlock()
    const at = scope ?? document.documentElement
    const delay = tune(at, cue, 'delay', 0)
    const rate = tune(at, cue, 'rate', 1) * rateScale
    const gain = tune(at, cue, 'gain', 1)
    // A recipe's length is its envelopes, so `head` and `cut` stay sample-only.
    // Clamped to now for the same reason the sample path is: a start in the
    // past is played immediately, which is late but never silent.
    const t0 = Math.max(ac.currentTime, ac.currentTime + (delay + offsetMs) / 1000)
    render(ac, schedule(r, Math.max(0.05, rate)), t0, gain)
    return
  }

  const buf = buffers.get(cue)
  ...
```

Clamp the sample path's `t0` the same way, so both branches behave identically when `offsetMs` is negative — Task 3 starts producing negative offsets:

```ts
  const t0 = Math.max(ac.currentTime, ac.currentTime + (delay + offsetMs) / 1000)
```

- [ ] **Step 7: Prove nothing regressed and the recipes actually sound**

Run: `npm test`
Expected: PASS, all existing tests plus the new ones.

Run: `npm run typecheck`
Expected: clean.

Run: `npm run motion`, then in the browser at `/anim.html` pick the stamp scenario and hit **Retrigger**. Expected: a click, synthesized, on the same frame as the stamp. Check the same for the leader scenario, which fires `leader` and `leader2` together. The welcome bed is untouched and still plays from `welcome.ogg`.

- [ ] **Step 8: Commit**

```bash
git add client/synth.ts client/cues.ts client/cues.test.ts client/sound.ts
git commit -m "feat: render recipes, and play() resolving recipe or sample"
```

---

### Task 3: Ordering by the attack you hear

**Files:**
- Modify: `client/sound.ts:185-191` (`playSpaced`)
- Test: `client/sound.test.ts`

**Interfaces:**
- Consumes: `onset` from Task 1, `recipeFor` from Task 2.
- Produces: `function spacedPlan(now: number, free: number, gap: number, onsets: number[]): { free: number; offsets: number[] }` — all arguments and results in **milliseconds**.

The arithmetic moves into a pure function so it can be tested from Node; `playSpaced` becomes a thin wrapper that converts the audio clock to milliseconds and back. This is the whole reason the change is testable without WebAudio.

- [ ] **Step 1: Write the failing tests**

Append to `client/sound.test.ts`:

```ts
import { spacedPlan } from './sound.ts'

// Today's samples all have onset zero — trimming dead air off the front is
// exactly what `head` does — so this case must stay bit-for-bit what it was.
test('a sample cue with no onset is scheduled exactly on its slot', () => {
  const p = spacedPlan(1000, 0, 100, [0])
  assert.deepEqual(p.offsets, [0])
  assert.equal(p.free, 1100)
})

test('a cue with an onset starts earlier than its slot by exactly that much', () => {
  const p = spacedPlan(1000, 1300, 100, [120])
  // Heard at 1300, so it starts at 1180 — 180ms from now.
  assert.deepEqual(p.offsets, [180])
  assert.equal(p.free, 1400)
})

test('cues in one moment share the slot and are each pulled back by their own onset', () => {
  const p = spacedPlan(1000, 1300, 100, [0, 120])
  assert.deepEqual(p.offsets, [300, 180])
  assert.equal(p.free, 1400, 'one moment costs one gap, not one per cue')
})

// Less lead than onset: the cue cannot start before now, so it is simply late,
// exactly as it would have been before any of this existed.
test('an onset longer than the lead clamps to now rather than to the past', () => {
  const p = spacedPlan(1000, 1000, 100, [120])
  assert.deepEqual(p.offsets, [0])
})

test('a moment arriving into a quiet room does not wait', () => {
  const p = spacedPlan(5000, 1000, 100, [0])
  assert.deepEqual(p.offsets, [0])
  assert.equal(p.free, 5100)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test client/sound.test.ts`
Expected: FAIL — `spacedPlan` is not exported.

- [ ] **Step 3: Replace `playSpaced` in `client/sound.ts`**

```ts
/**
 * Where each cue of one moment starts, in ms from now.
 *
 * Slots are spaced by when a cue is *heard*, not when it starts, because the
 * ear times a sound by its attack. A cue with a 120ms onset therefore starts
 * 120ms before its slot so that its attack lands on it. `delay` is untouched by
 * any of this and keeps its full power to reorder: `delay` is an offset you
 * asked for, `onset` is latency you did not.
 *
 * Pure so it can be checked without a browser — the audio clock is the caller's
 * problem.
 */
export function spacedPlan(
  now: number,
  free: number,
  gap: number,
  onsets: number[],
): { free: number; offsets: number[] } {
  const heard = Math.max(now, free)
  return {
    free: heard + gap,
    // A cue whose onset is longer than the lead available cannot start in the
    // past, so it is late instead. Which is what it would have been anyway.
    offsets: onsets.map((o) => Math.max(0, heard - o - now)),
  }
}

/**
 * Fire a cue, never sooner than a gap after the last one.
 *
 * Several cues given together are one moment, not several: they share the slot
 * and cost one gap between them. Each still has its own `delay`, which is how
 * two layers of the same moment are moved against each other.
 *
 * Returns nothing to align a picture against on purpose: the caller schedules
 * its own visuals in its own clock. What is shared is the gap, not the moment.
 */
export function playSpaced(cue: Cue | Cue[], scope?: Element): void {
  const ac = unlock()
  const cues = [cue].flat()
  const now = ac.currentTime * 1000
  const plan = spacedPlan(
    now,
    nextFree * 1000,
    markGap(scope),
    cues.map((c) => onset(recipeFor(c) ?? [])),
  )
  nextFree = plan.free / 1000
  cues.forEach((c, i) => play(c, { scope, offsetMs: plan.offsets[i] }))
}
```

`nextFree` keeps its seconds-on-the-audio-clock meaning and its comment; only the arithmetic around it changed units.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test client/sound.test.ts`
Expected: PASS — the three original `parseTune` tests plus the five new ones.

- [ ] **Step 5: Watch it in a real run**

Run: `npm run build && npm start`, then in another shell:

```bash
npm run probe -- value:400 join:Ada,Bo,Cy,Dee arm buzz:Ada@0,Bo@140,Cy@390,Dee@700
```

Expected: four marks land as a staircase, each click evenly spaced from the last, none doubled up. Then `npm run probe -- clear`.

- [ ] **Step 6: Commit**

```bash
git add client/sound.ts client/sound.test.ts
git commit -m "feat: space cues by the attack you hear, not the instant they start"
```

---

### Task 4: Recipe dials in the harness, and Save that carries them

**Files:**
- Modify: `client/anim/scenarios.tsx:27-73`
- Modify: `client/anim/main.tsx:42-47`, `:174-212`, `:302-376`
- Modify: `vite.config.ts:19-65`

**Interfaces:**
- Consumes: `RECIPES`, `getPath`, `withOverrides` from Task 2; `Dial` from `scenarios.tsx`.
- Produces: `Dial` gains `{ recipe: string; label: string; min: number; max: number; step: number; unit: string }`; `function dialKey(d: Dial): string`; `function recipeDials(cue: string): Dial[]`; `POST /__anim/save` accepts `{ css: Record<string,string>, recipes: Record<string, Recipe> }`.

- [ ] **Step 1: Extend `Dial` and add the builders in `client/anim/scenarios.tsx`**

Replace the `Dial` type:

```ts
/**
 * A number the harness can move.
 *
 * Two kinds, told apart by which one they address: `var` is a CSS custom
 * property in the `anim:tunables` block, `recipe` is a field in a cue's recipe
 * written as `cue.layer.field`. Everything downstream — the slider, the origin
 * marker, the dirty state, Save — works the same on both, which is the point of
 * giving them one type.
 */
export type Dial =
  | { var: string; label: string; min: number; max: number; step: number; unit: string }
  | { var: string; label: string; text: true }
  | { recipe: string; label: string; min: number; max: number; step: number; unit: string }

/** What a dial is stored under. The two kinds never collide: one has dashes. */
export const dialKey = (d: Dial) => ('var' in d ? d.var : d.recipe)
```

Add the recipe-dial builder beside `soundDials`:

```ts
import { RECIPES } from '../cues.ts'
import type { Layer } from '../synth.ts'

/** Range and step per recipe field. One table, so every layer dials alike. */
const FIELD: Record<string, { max: number; step: number; unit: string }> = {
  freq: { max: 4000, step: 10, unit: 'Hz' },
  freqTo: { max: 4000, step: 10, unit: 'Hz' },
  attack: { max: 400, step: 1, unit: 'ms' },
  decay: { max: 2000, step: 5, unit: 'ms' },
  sustain: { max: 1, step: 0.05, unit: '' },
  hold: { max: 4000, step: 20, unit: 'ms' },
  release: { max: 2000, step: 5, unit: 'ms' },
  gain: { max: 1.5, step: 0.05, unit: '' },
  delay: { max: 600, step: 5, unit: 'ms' },
  head: { max: 1000, step: 5, unit: 'ms' },
}

/**
 * Every numeric field actually present in a cue's recipe, as dials.
 *
 * Driven off the recipe rather than off a written-out list, so adding a layer
 * to `cues.ts` gives you its dials without touching this file — and so a
 * scenario can never restate a value the recipe already carries.
 */
export function recipeDials(cue: string): Dial[] {
  const recipe = (RECIPES as Record<string, Layer[]>)[cue] ?? []
  return recipe.flatMap((layer, i) =>
    Object.keys(FIELD)
      .filter((f) => typeof layer[f as keyof Layer] === 'number')
      .map((f) => ({
        recipe: `${cue}.${i}.${f}`,
        label: `${cue} L${i + 1} ${f}`,
        min: 0,
        ...FIELD[f],
      })),
  )
}
```

Then, in each scenario that has a `sound`, replace its `soundDials(cue)` spread with `...soundDials(cue), ...recipeDials(cue)`. `soundDials` stays: `delay` and `gain` are still the cue's relationship to the movement and still live in CSS.

- [ ] **Step 2: Key the harness's state by `dialKey` in `client/anim/main.tsx`**

Replace `readDefaults`:

```ts
import { RECIPES, getPath, withOverrides } from '../cues.ts'
import { SCENARIOS, dialKey, type Dial } from './scenarios.tsx'

/**
 * Where each dial starts. CSS dials read the stylesheet, recipe dials read the
 * committed table — both are "what is in the file", which is what an origin
 * marker has to mean for Reset to be honest.
 */
function readDefaults(dials: Dial[]): Record<string, string> {
  const root = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const d of dials)
    out[dialKey(d)] =
      'var' in d ? root.getPropertyValue(d.var).trim() : String(getPath(RECIPES, d.recipe) ?? 0)
  return out
}
```

Then replace every `d.var` inside the dial-rendering block (`origin[d.var]`, `values[d.var]`, `key={d.var}`, both `setValues` updaters, and the `Reset all` button's `some(...)` predicate) with a `const k = dialKey(d)` computed at the top of the map callback. The slider's `onInput` must not append a unit for a recipe dial — a recipe field is a number, not a CSS string:

```ts
{scenario.dials.map((d) => {
  const k = dialKey(d)
  const was = origin[k] ?? ''
  const now = values[k] ?? ''
  const moved = now !== was
  const back = () => setValues((v) => ({ ...v, [k]: was }))
  ...
                  onInput={(e) =>
                    setValues((v) => ({
                      ...v,
                      [k]: 'var' in d
                        ? `${(e.target as HTMLInputElement).value}${d.unit}`
                        : (e.target as HTMLInputElement).value,
                    }))
                  }
```

The stage's inline `style={values}` must now receive only the CSS half, or Preact will try to set `stamp.0.decay` as a style property:

```ts
const cssValues = Object.fromEntries(
  Object.entries(values).filter(([k]) => k.startsWith('--')),
)
```

Use `cssValues` for both the `<pre class="harness__css">` preview and `style={cssValues}` on the stage.

- [ ] **Step 3: Play the dialled recipe, not the committed one**

In the effect that fires the cue on the trigger edge, pass the override — this is the same reasoning as scoping `play()` to the stage. A recipe tuned against the committed table while you drag a slider would be tuning nothing.

```ts
  useEffect(() => {
    if (lead || muted || !scenario.sound) return
    const live = withOverrides(RECIPES, values)
    for (const cue of [scenario.sound].flat())
      play(cue, {
        scope: stage.current ?? undefined,
        rateScale: follow ? speed : 1,
        recipe: live[cue],
      })
  }, [lead])
```

- [ ] **Step 4: Send both halves from Save**

```ts
  const save = async () => {
    setSaved('saving')
    try {
      const css = Object.fromEntries(Object.entries(values).filter(([k]) => k.startsWith('--')))
      const res = await fetch('/__anim/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ css, recipes: withOverrides(RECIPES, values) }),
      })
      const body = await res.json()
      if (res.ok) setOrigin({ ...values })
      setSaved(res.ok ? `saved ${body.written} to style.css, ${body.cues} cues` : `failed: ${body.error}`)
    } catch (err) {
      setSaved(`failed: ${(err as Error).message}`)
    }
    setTimeout(() => setSaved(''), 4000)
  }
```

Recipe values only reach the file on reload, because `RECIPES` is the module's committed copy and Vite's HMR will re-import it after the write. That is the correct behaviour: `origin` re-captures on a successful save, so the markers move to the values you just committed.

- [ ] **Step 5: Teach `/__anim/save` the recipes half in `vite.config.ts`**

Add beside the CSS constants:

```ts
const CUES = fileURLToPath(new URL('./client/cues.ts', import.meta.url))
const R_OPEN = '/* cue:recipes'
const R_CLOSE = '/* /cue:recipes */'
```

Then, inside the handler, after the body is parsed:

```ts
          const { css: values = {}, recipes } = JSON.parse(
            Buffer.concat(chunks).toString(),
          ) as { css?: Record<string, string>; recipes?: unknown }
```

and after the CSS write, before the reply:

```ts
          let cues = 0
          if (recipes && typeof recipes === 'object') {
            const src = await readFile(CUES, 'utf8')
            const rs = src.indexOf(R_OPEN)
            const re = src.indexOf(R_CLOSE)
            if (rs === -1 || re === -1) return reply(500, { error: 'cue markers missing' })
            // Regenerated wholesale rather than line-matched: a recipe is a
            // tree, and there is no per-line identity to match against. Quoted
            // keys are valid TypeScript and the repo has no formatter to fight.
            const head = src.slice(0, rs)
            const marker = src.slice(rs, src.indexOf('*/', rs) + 2)
            const body =
              `\nexport const RECIPES = ${JSON.stringify(recipes, null, 2)}` +
              ` satisfies Record<string, Recipe>\n`
            await writeFile(CUES, head + marker + body + src.slice(re))
            cues = Object.keys(recipes).length
          }
          reply(200, { written, cues })
```

- [ ] **Step 6: Verify the round trip by hand**

Run: `npm run motion`. Pick the stamp scenario, drag `stamp L1 decay`, hit **Retrigger** — the click must change. Hit **Save to style.css**, then:

Run: `git diff client/cues.ts`
Expected: the decay you dialled, inside the markers, with the prose comment above them intact and the `import type { Recipe }` line untouched.

Run: `npm run typecheck`
Expected: clean — the regenerated block must still be valid TypeScript. If it is not, the marker slice is wrong.

Then dial a CSS value and save again, and confirm `git diff client/style.css` shows only that line.

- [ ] **Step 7: Commit**

```bash
git add client/anim/scenarios.tsx client/anim/main.tsx vite.config.ts
git commit -m "feat: recipe dials in the harness, written back beside the CSS"
```

---

### Task 5: The envelope canvas

**Files:**
- Create: `client/anim/Envelope.tsx`
- Modify: `client/anim/main.tsx` (render one per layer of the scenario's cues)
- Modify: `client/style.css` (styles, outside the tunables markers)

**Interfaces:**
- Consumes: `Layer` from Task 1, `getPath` from Task 2, the harness's `values` / `setValues`.
- Produces: `function Envelope(props: { path: string; layer: Layer; onChange: (field: string, value: number) => void }): JSX.Element`.

This is the one genuinely new control. Everything else in the panel is a range input, and it should stay that way.

- [ ] **Step 1: Write `client/anim/Envelope.tsx`**

```tsx
/**
 * An envelope you drag rather than four sliders you infer it from.
 *
 * The sliders still exist and still work — this draws the same four numbers as
 * one shape, because attack against decay is a relationship and two independent
 * sliders hide it. Horizontal drag is time; vertical drag on the sustain corner
 * is level.
 *
 * ponytail: no zoom, no snapping, no curve shaping. The x axis is the layer's
 * own total length, so the shape rescales as you drag and stays legible for a
 * 40ms click and a 3s buzzer alike.
 */
import { useRef } from 'preact/hooks'
import type { Layer } from '../synth.ts'

const W = 260
const H = 90
const PAD = 8

type Handle = { field: 'attack' | 'decay' | 'hold' | 'release'; x: number; y: number; level: boolean }

export function Envelope({
  layer,
  onChange,
}: {
  layer: Layer
  onChange: (field: string, value: number) => void
}) {
  const box = useRef<SVGSVGElement>(null)
  const a = layer.attack ?? 0
  const d = layer.decay ?? 0
  const h = layer.hold ?? 0
  const r = layer.release ?? 0
  const s = layer.sustain ?? 0
  const total = Math.max(1, a + d + h + r)

  const x = (t: number) => PAD + (t / total) * (W - PAD * 2)
  const y = (v: number) => H - PAD - v * (H - PAD * 2)

  const handles: Handle[] = [
    { field: 'attack', x: x(a), y: y(1), level: false },
    { field: 'decay', x: x(a + d), y: y(s), level: true },
    { field: 'hold', x: x(a + d + h), y: y(s), level: false },
    { field: 'release', x: x(total), y: y(0), level: false },
  ]

  const points = `${x(0)},${y(0)} ${handles.map((p) => `${p.x},${p.y}`).join(' ')}`

  /**
   * Drag as a delta, not as a position.
   *
   * A handle's absolute x is the sum of every stage before it, so reading a
   * position would need that sum inverted; a delta only ever changes the one
   * field under the pointer, and dragging attack shifts everything after it
   * exactly as it does in the sound.
   */
  const grab = (e: PointerEvent, hnd: Handle) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const rect = box.current!.getBoundingClientRect()
    const perPx = total / ((W - PAD * 2) * (rect.width / W))
    const from = { x: e.clientX, y: e.clientY, t: layer[hnd.field] ?? 0, s }

    const move = (m: PointerEvent) => {
      onChange(hnd.field, Math.max(0, Math.round(from.t + (m.clientX - from.x) * perPx)))
      if (hnd.level) {
        const dy = (m.clientY - from.y) / (rect.height * ((H - PAD * 2) / H))
        onChange('sustain', Math.min(1, Math.max(0, Number((from.s - dy).toFixed(2)))))
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <svg ref={box} class="envelope" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="envelope">
      <polyline class="envelope__line" points={points} />
      {handles.map((hnd) => (
        <circle
          key={hnd.field}
          class="envelope__handle"
          cx={hnd.x}
          cy={hnd.y}
          r={6}
          onPointerDown={(e) => grab(e as unknown as PointerEvent, hnd)}
        >
          <title>{hnd.field}</title>
        </circle>
      ))}
    </svg>
  )
}
```

`sustain` is not in `handles` as its own entry on purpose: it is the vertical axis of the decay corner, which is where it actually lives in the shape.

- [ ] **Step 2: Add the styles to `client/style.css`**

Put these at the end of the file, well outside the `anim:tunables` markers — the harness's own chrome is not a tunable.

```css
/* --- the harness envelope canvas ------------------------------------- */
.envelope {
  width: 100%;
  height: auto;
  background: var(--surface-2, #0e1116);
  border-radius: 6px;
  touch-action: none;
}
.envelope__line {
  fill: none;
  stroke: var(--accent, #4dd6e8);
  stroke-width: 2;
}
.envelope__handle {
  fill: var(--accent, #4dd6e8);
  cursor: ew-resize;
}
.envelope__handle:hover {
  fill: #fff;
}
```

- [ ] **Step 3: Render one per layer in `client/anim/main.tsx`**

Above the dial list, after the `<p class="eyebrow">{scenario.label}</p>` line:

```tsx
{[scenario.sound ?? []].flat().map((cue) =>
  (live[cue] ?? []).map((layer, i) => (
    <Envelope
      key={`${cue}.${i}`}
      layer={layer}
      onChange={(field, value) =>
        setValues((v) => ({ ...v, [`${cue}.${i}.${field}`]: String(value) }))
      }
    />
  )),
)}
```

where `live` is hoisted out of the trigger effect so the canvas and the sound read the same object:

```ts
const live = withOverrides(RECIPES, values)
```

Note the consequence: dragging a handle for a field the recipe does not currently carry writes a value `withOverrides` will drop, because that function refuses to invent a field. That is the right default — a layer with no `release` has no release handle to drag beyond zero — and it is why `Envelope` reads its shape from `live` rather than from raw `values`.

- [ ] **Step 4: Verify by hand**

Run: `npm run motion`. On the leader scenario, drag the decay corner sideways and hit **Retrigger** — the drop must get longer. Drag it down; the tail must get quieter. Confirm the matching slider readout moves with the handle, since both are views of the same `values` entry.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add client/anim/Envelope.tsx client/anim/main.tsx client/style.css
git commit -m "feat: drag the envelope instead of inferring it from four sliders"
```

---

### Task 6: The library — a holding ground, listed and auditionable

**Files:**
- Modify: `.gitignore`
- Create: `tools/sndlib.ts`, `tools/sndlib.test.ts`
- Modify: `package.json` (test glob)
- Modify: `vite.config.ts` (new `sndLibrary()` plugin)
- Modify: `client/anim/main.tsx` (the library list)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `function safeRaw(root: string, name: string): string | null`; `GET /__snd/library` → `{ files: { name: string; size: number; mtime: number }[] }`; `GET /__snd/raw/<name>` → the bytes.

- [ ] **Step 1: Create the holding ground and ignore it**

```bash
mkdir -p sounds/raw
```

Add to `.gitignore`, with the reason:

```
node_modules/
dist/
state.json
# Downloads waiting to be auditioned. Deliberately messy and deliberately not
# in the repo — what survives gets adopted into client/public/sounds.
sounds/raw/
```

- [ ] **Step 2: Write the failing test for path safety**

Create `tools/sndlib.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { safeRaw } from './sndlib.ts'

const ROOT = '/repo/sounds/raw'

test('a plain name resolves inside the holding ground', () => {
  assert.equal(safeRaw(ROOT, 'buzzer.wav'), '/repo/sounds/raw/buzzer.wav')
})

// Dev-only is not a reason to skip this. The moment a name crosses an HTTP
// boundary it is untrusted, and a traversal here reads any file on the machine.
test('a name escaping the holding ground is refused', () => {
  assert.equal(safeRaw(ROOT, '../../etc/passwd'), null)
  assert.equal(safeRaw(ROOT, '/etc/passwd'), null)
  assert.equal(safeRaw(ROOT, 'nested/../../out.wav'), null)
})

test('a name that is not audio is refused', () => {
  assert.equal(safeRaw(ROOT, 'notes.txt'), null)
  assert.equal(safeRaw(ROOT, ''), null)
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test tools/sndlib.test.ts`
Expected: FAIL — `Cannot find module './sndlib.ts'`.

- [ ] **Step 4: Write `tools/sndlib.ts`**

```ts
/**
 * The pure half of the sound library middleware.
 *
 * Everything here is a decision — is this path safe, is this name allowed, what
 * exactly does ffmpeg get told — and nothing here touches the disk or spawns
 * anything. That is what makes it testable from Node in a few lines, and it is
 * why the Vite plugin that uses it stays a thin shell.
 */
import { basename, resolve } from 'node:path'

const AUDIO = /\.(wav|mp3|ogg|flac|aiff?|m4a)$/i

/**
 * A raw file's absolute path, or null if the name has no business being served.
 *
 * Reduced to a basename first, then re-checked after resolution: the basename
 * handles the obvious traversal and the prefix check handles whatever the
 * basename did not think of.
 */
export function safeRaw(root: string, name: string): string | null {
  const base = basename(name)
  if (!base || base.startsWith('.') || !AUDIO.test(base)) return null
  const full = resolve(root, base)
  return full.startsWith(resolve(root) + '/') ? full : null
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tools/sndlib.test.ts`
Expected: PASS, three tests.

- [ ] **Step 6: Put the new test file in the suite**

In `package.json`:

```json
    "test": "node --test 'server/*.test.ts' 'client/*.test.ts' 'tools/*.test.ts'",
```

Run: `npm test`
Expected: PASS, everything.

- [ ] **Step 7: Add the `sndLibrary()` plugin to `vite.config.ts`**

```ts
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { safeRaw } from './tools/sndlib.ts'

const RAW = fileURLToPath(new URL('./sounds/raw', import.meta.url))

/**
 * Serves the holding ground to the harness.
 *
 * `apply: 'serve'` for the same reason `animSave` has it: there is no built
 * artefact in which any of this exists, so no production path reads a file off
 * the developer's disk by name.
 */
function sndLibrary(): Plugin {
  return {
    name: 'snd-library',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__snd/library', async (_req, res) => {
        res.setHeader('content-type', 'application/json')
        try {
          const names = await readdir(RAW)
          const files = []
          for (const name of names) {
            if (!safeRaw(RAW, name)) continue
            const s = await stat(resolve(RAW, name))
            files.push({ name, size: s.size, mtime: s.mtimeMs })
          }
          files.sort((a, b) => b.mtime - a.mtime)
          res.end(JSON.stringify({ files }))
        } catch {
          // No holding ground yet is an empty library, not an error.
          res.end(JSON.stringify({ files: [] }))
        }
      })

      server.middlewares.use('/__snd/raw', (req, res) => {
        const full = safeRaw(RAW, decodeURIComponent((req.url ?? '').split('?')[0].slice(1)))
        if (!full) {
          res.statusCode = 400
          return res.end('bad name')
        }
        createReadStream(full)
          .on('error', () => {
            res.statusCode = 404
            res.end('not found')
          })
          .pipe(res)
      })
    },
  }
}
```

Register it: `plugins: [preact(), animSave(), sndLibrary()]`.

`resolve` and `readdir`/`stat` are new imports at the top of the file; `createReadStream` comes from `node:fs`, not `node:fs/promises`.

- [ ] **Step 8: Add the library list to the harness panel**

In `client/anim/main.tsx`, after the Write-back row:

```tsx
const [library, setLibrary] = useState<{ name: string; size: number }[]>([])
useEffect(() => {
  fetch('/__snd/library')
    .then((r) => r.json())
    .then((b) => setLibrary(b.files))
    .catch(() => {})
}, [])

/**
 * Audition a raw download through whatever is dialled in right now.
 *
 * Through the dials, not raw: the question you are asking a download is "does
 * this work trimmed and pitched the way I need it", and a raw preview answers a
 * different question.
 */
const [auditioning, setAuditioning] = useState('')
const audition = async (name: string) => {
  setAuditioning(name)
  const ac = unlock()
  const buf = await ac.decodeAudioData(
    await (await fetch(`/__snd/raw/${encodeURIComponent(name)}`)).arrayBuffer(),
  )
  const src = ac.createBufferSource()
  src.buffer = buf
  src.playbackRate.value = Math.max(0.05, num(values['--audition-rate'] ?? '1'))
  src.connect(ac.destination)
  src.start(0, num(values['--audition-head'] ?? '0') / 1000)
  src.onended = () => setAuditioning('')
}
```

and the markup:

```tsx
<p class="eyebrow">Library</p>
{library.length === 0 && <p class="harness__note">Nothing in sounds/raw/ yet.</p>}
{library.map((f) => (
  <div class="harness__row" key={f.name}>
    <button class={auditioning === f.name ? 'btn btn--go' : 'btn'} onClick={() => audition(f.name)}>
      ▶
    </button>
    <span class="harness__unit">{f.name}</span>
    <span class="readout">{Math.round(f.size / 1024)}k</span>
  </div>
))}
```

Add the two audition dials to `client/style.css` inside the `anim:tunables` markers, beside the other sound values, so they are dialled and saved like everything else:

```css
  /* The library auditions through these, so what you hear is the trim you are
     about to bake in rather than the raw download. */
  --audition-head: 0ms;
  --audition-cut: 0ms;
  --audition-rate: 1;
```

and expose them as a constant dial group in `scenarios.tsx`, appended to every sound scenario's dials:

```ts
export const AUDITION: Dial[] = [
  { var: '--audition-head', label: 'Audition head', min: 0, max: 4000, step: 10, unit: 'ms' },
  { var: '--audition-cut', label: 'Audition cut (0 = whole)', min: 0, max: 20000, step: 100, unit: 'ms' },
  { var: '--audition-rate', label: 'Audition rate / pitch', min: 0.25, max: 4, step: 0.05, unit: '' },
]
```

- [ ] **Step 9: Verify by hand**

Drop any `.wav` into `sounds/raw/`, run `npm run motion`, and confirm it appears in the Library list with its size. Press ▶ — it plays. Move Audition head to 500ms and press again — it starts half a second in.

Run: `git status`
Expected: `sounds/raw/` does not appear.

- [ ] **Step 10: Commit**

```bash
git add .gitignore package.json tools/sndlib.ts tools/sndlib.test.ts vite.config.ts client/anim/main.tsx client/anim/scenarios.tsx client/style.css
git commit -m "feat: a holding ground for downloads, listed and auditioned in the harness"
```

---

### Task 7: Adopt — the ffmpeg pass and the credits row

**Files:**
- Modify: `tools/sndlib.ts`, `tools/sndlib.test.ts`
- Modify: `vite.config.ts` (the adopt route)
- Modify: `client/anim/main.tsx` (the adopt control)
- Modify: `client/public/sounds/CREDITS.md` (appended to at runtime)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `safeRaw` from Task 6.
- Produces: `function safeOut(name: string): string | null`; `function ffmpegArgs(o: AdoptOpts): string[]`; `function creditsRow(o: { out: string; role: string; source: string; command: string }): string`; `POST /__snd/adopt` → `{ command: string, out: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sndlib.test.ts`:

```ts
import { safeOut, ffmpegArgs, creditsRow } from './sndlib.ts'

test('an output name must be lowercase, hyphenated, and audio', () => {
  assert.equal(safeOut('stamp.wav'), 'stamp.wav')
  assert.equal(safeOut('leader-2.ogg'), 'leader-2.ogg')
  assert.equal(safeOut('Stamp.wav'), null)
  assert.equal(safeOut('../stamp.wav'), null)
  assert.equal(safeOut('stamp.mp3'), null)
  assert.equal(safeOut('stamp'), null)
})

// The one-shot preset is the pass CREDITS.md has been describing by hand: trim,
// then the same 40ms release play() would have applied, mono, 44.1k, PCM.
test('the one-shot preset trims, fades, and stays uncompressed', () => {
  const args = ffmpegArgs({
    preset: 'one-shot',
    input: '/raw/in.wav',
    output: '/out/stamp.wav',
    headMs: 100,
    cutMs: 3140,
    rate: 1,
  })
  assert.deepEqual(args, [
    '-y',
    '-i',
    '/raw/in.wav',
    '-af',
    'atrim=0.1:3.14,asetpts=N/SR/TB,afade=t=out:st=3:d=0.04',
    '-ac',
    '1',
    '-ar',
    '44100',
    '/out/stamp.wav',
  ])
})

test('a rate other than 1 moves speed and pitch together, and the fade with them', () => {
  const args = ffmpegArgs({
    preset: 'one-shot',
    input: '/raw/in.wav',
    output: '/out/leader.wav',
    headMs: 0,
    cutMs: 4000,
    rate: 2,
  })
  const af = args[args.indexOf('-af') + 1]
  assert.ok(af.includes('asetrate=88200'), af)
  assert.ok(af.includes('aresample=44100'), af)
  // 4s at 2x is 2s out, so the 40ms fade starts at 1.96 rather than 3.96.
  assert.ok(af.includes('afade=t=out:st=1.96:d=0.04'), af)
})

test('cut 0 means the whole file and produces no atrim end', () => {
  const af = ffmpegArgs({
    preset: 'one-shot',
    input: '/raw/in.wav',
    output: '/out/x.wav',
    headMs: 250,
    cutMs: 0,
    rate: 1,
  })[4]
  assert.ok(af.startsWith('atrim=0.25,'), af)
  assert.ok(!af.includes('afade'), 'no known end, so nothing to fade against')
})

test('the bed preset is opus and nothing else', () => {
  assert.deepEqual(
    ffmpegArgs({ preset: 'bed', input: '/raw/m.wav', output: '/out/welcome.ogg', headMs: 0, cutMs: 0, rate: 1 }),
    ['-y', '-i', '/raw/m.wav', '-c:a', 'libopus', '-b:a', '64k', '-ac', '1', '/out/welcome.ogg'],
  )
})

test('a credits row carries the command that produced the file', () => {
  const row = creditsRow({
    out: 'stamp.wav',
    role: 'A mark landing',
    source: 'raw/click.wav',
    command: 'ffmpeg -y -i a b',
  })
  assert.match(row, /^\| `stamp.wav` \| A mark landing \| /)
  assert.ok(row.includes('`ffmpeg -y -i a b`'))
  assert.ok(row.endsWith(' |\n'))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/sndlib.test.ts`
Expected: FAIL — `safeOut is not a function`.

- [ ] **Step 3: Append to `tools/sndlib.ts`**

```ts
export type AdoptOpts = {
  preset: 'one-shot' | 'bed'
  input: string
  output: string
  /** The dialled trim, in ms. `cutMs: 0` means the whole file. */
  headMs: number
  cutMs: number
  rate: number
}

/** How long the cut takes to fall silent, matching `RELEASE_MS` in sound.ts. */
const FADE_S = 0.04

/** An adopted file's name. Narrow on purpose: this becomes a path we write. */
export function safeOut(name: string): string | null {
  return /^[a-z0-9-]+\.(wav|ogg)$/.test(name) ? name : null
}

/**
 * The exact argument list, so the credits row can quote what actually ran.
 *
 * One-shot bakes the dialled trim and rate into PCM. Rate is `asetrate` plus
 * `aresample` rather than `atempo`, because speed and pitch are one knob at
 * runtime and the baked file has to match what you heard while dialling it.
 *
 * ponytail: one input file. Muxing several is not built — layers already mix at
 * play time, and a baked mix would be an OfflineAudioContext render rather than
 * an ffmpeg graph.
 */
export function ffmpegArgs(o: AdoptOpts): string[] {
  if (o.preset === 'bed')
    return ['-y', '-i', o.input, '-c:a', 'libopus', '-b:a', '64k', '-ac', '1', o.output]

  const head = o.headMs / 1000
  const cut = o.cutMs / 1000
  const rate = Math.max(0.05, o.rate)
  const chain = [cut > head ? `atrim=${head}:${cut}` : `atrim=${head}`, 'asetpts=N/SR/TB']
  if (rate !== 1) chain.push(`asetrate=${Math.round(44100 * rate)}`, 'aresample=44100')
  // Only a known end can be faded against; `cut: 0` is the whole file, whose
  // length this function does not know and should not go and read.
  if (cut > head) {
    const out = (cut - head) / rate
    chain.push(`afade=t=out:st=${Number((out - FADE_S).toFixed(4))}:d=${FADE_S}`)
  }
  return ['-y', '-i', o.input, '-af', chain.join(','), '-ac', '1', '-ar', '44100', o.output]
}

/** One row of CREDITS.md, trailing newline included. */
export function creditsRow(o: {
  out: string
  role: string
  source: string
  command: string
}): string {
  return `| \`${o.out}\` | ${o.role} | From \`${o.source}\` via \`${o.command}\` |\n`
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/sndlib.test.ts`
Expected: PASS, eight tests.

- [ ] **Step 5: Add the adopt route to `sndLibrary()` in `vite.config.ts`**

```ts
import { execFile } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { ffmpegArgs, creditsRow, safeOut, safeRaw } from './tools/sndlib.ts'

const run = promisify(execFile)
const OUT = fileURLToPath(new URL('./client/public/sounds', import.meta.url))
const CREDITS = fileURLToPath(new URL('./client/public/sounds/CREDITS.md', import.meta.url))
```

Inside `configureServer`, alongside the other two:

```ts
      server.middlewares.use('/__snd/adopt', async (req, res) => {
        const reply = (code: number, body: unknown) => {
          res.statusCode = code
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (req.method !== 'POST') return reply(405, { error: 'POST only' })
        try {
          const chunks: Buffer[] = []
          for await (const c of req) chunks.push(c as Buffer)
          const b = JSON.parse(Buffer.concat(chunks).toString())

          const input = safeRaw(RAW, String(b.name ?? ''))
          const out = safeOut(String(b.out ?? ''))
          if (!input) return reply(400, { error: 'no such raw file' })
          if (!out) return reply(400, { error: 'output must match [a-z0-9-]+.(wav|ogg)' })

          const args = ffmpegArgs({
            preset: b.preset === 'bed' ? 'bed' : 'one-shot',
            input,
            output: resolve(OUT, out),
            headMs: Number(b.headMs) || 0,
            cutMs: Number(b.cutMs) || 0,
            rate: Number(b.rate) || 1,
          })
          await run('ffmpeg', args)

          const command = `ffmpeg ${args.join(' ')}`
          await appendFile(
            CREDITS,
            creditsRow({
              out,
              role: String(b.role ?? 'TODO — say what this is for'),
              source: basename(input),
              command,
            }),
          )
          reply(200, { command, out })
        } catch (err) {
          const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'ffmpeg is not on PATH'
            : (err as Error).message
          reply(500, { error: msg })
        }
      })
```

`basename` and `resolve` both come from `node:path`.

The credits row is appended to the end of the file, which puts it after the closing prose rather than inside the table. Fix that by moving the two closing paragraphs of `CREDITS.md` above the table before shipping this, so an append always lands in the right place:

- [ ] **Step 6: Reorder `client/public/sounds/CREDITS.md` so appends land in the table**

Move the final paragraph ("Check each sound's licence on Freesound…") to sit immediately before the table's header row, and add one line explaining the new arrangement:

```markdown
Check each sound's licence on Freesound before this goes anywhere public;
several are CC-BY and want the attribution above carried with them.

The table is the last thing in this file because the harness's Adopt button
appends to it. A row it writes carries the exact ffmpeg command that produced
the file, which is the whole point of the column.

| File | Role | Source and pass |
```

- [ ] **Step 7: Add the adopt control to the harness**

Adopt must operate on the file you just heard, not on whatever is at the top of
the list, so the ▶ handler from Task 6 records it. Change `audition` to set
`selected` as its first act, and use that state everywhere below:

```ts
const [selected, setSelected] = useState('')

const audition = async (name: string) => {
  setSelected(name)
  setAuditioning(name)
  // ...unchanged from Task 6
}
```

Then the adopt control itself:

```tsx
const [adopting, setAdopting] = useState('')
const [outName, setOutName] = useState('')
const [role, setRole] = useState('')

const adopt = async (name: string, preset: 'one-shot' | 'bed') => {
  setAdopting('running ffmpeg…')
  try {
    const res = await fetch('/__snd/adopt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        out: outName,
        role,
        preset,
        headMs: num(values['--audition-head'] ?? '0'),
        cutMs: num(values['--audition-cut'] ?? '0'),
        rate: num(values['--audition-rate'] ?? '1'),
      }),
    })
    const body = await res.json()
    setAdopting(res.ok ? body.command : `failed: ${body.error}`)
    // The dials reset because what was dialled in is now baked into the file —
    // the convention CREDITS.md already states.
    if (res.ok)
      setValues((v) => ({
        ...v,
        '--audition-head': '0ms',
        '--audition-cut': '0ms',
        '--audition-rate': '1',
      }))
  } catch (err) {
    setAdopting(`failed: ${(err as Error).message}`)
  }
}
```

and the markup, below the library list:

```tsx
<div class="harness__row">
  <input
    class="input"
    placeholder="stamp.wav"
    value={outName}
    onInput={(e) => setOutName((e.target as HTMLInputElement).value)}
  />
  <input
    class="input"
    placeholder="what it is for"
    value={role}
    onInput={(e) => setRole((e.target as HTMLInputElement).value)}
  />
</div>
<div class="harness__row">
  <button class="btn" disabled={!selected || !outName} onClick={() => adopt(selected, 'one-shot')}>
    Adopt as one-shot
  </button>
  <button class="btn" disabled={!selected || !outName} onClick={() => adopt(selected, 'bed')}>
    Adopt as bed
  </button>
</div>
{selected && <p class="harness__note">Adopting {selected}</p>}
{adopting && <pre class="harness__css">{adopting}</pre>}
```

Both buttons stay disabled until something has been auditioned and named, because an adopt with no output name is a 400 the server has to reject anyway — better to not offer it.

- [ ] **Step 8: File-source layers**

`render` already handles `{ file }` sources but is never given a buffer map. Wire the last piece in `client/sound.ts`, so an adopted sample can sit in a recipe as a layer:

```ts
/** Decoded raw/adopted files, keyed by the path a `{ file }` layer names. */
const files = new Map<string, AudioBuffer>()

/** Decode a file so a `{ file }` layer can use it. Idempotent. */
export function primeFile(url: string): Promise<void> {
  if (files.has(url)) return Promise.resolve()
  return fetch(url)
    .then((r) => r.arrayBuffer())
    .then((b) => unlock().decodeAudioData(b))
    .then((buf) => void files.set(url, buf))
    .catch(() => {})
}
```

and pass it through in the recipe branch of `play()`:

```ts
    render(ac, schedule(r, Math.max(0.05, rate)), t0, gain, files)
```

In the harness, call `primeFile` for every `{ file }` source in the live recipe alongside the existing `prime(...)` effect, so the first trigger is not the silent one:

```ts
useEffect(() => {
  for (const cue of [scenario.sound ?? []].flat())
    for (const l of live[cue] ?? [])
      if (typeof l.source === 'object') void primeFile(l.source.file)
}, [id, values])
```

- [ ] **Step 9: Verify the whole loop by hand**

Put a download in `sounds/raw/`. Run `npm run motion`. Audition it, dial head and cut until it sounds right, type an output name, click **Adopt as one-shot**.

Expected: the command appears under the button; `client/public/sounds/<name>` exists; `git diff client/public/sounds/CREDITS.md` shows one new row at the end of the table quoting that exact command; the audition dials are back at neutral.

Run: `ffmpeg -version`
Expected: 8.1.2 or similar. If it is missing, the endpoint must say "ffmpeg is not on PATH" rather than a stack trace — check that by renaming it temporarily on `PATH` if you want to see it.

Run: `npm test && npm run typecheck && npm run build`
Expected: all clean, and `dist/` contains no `anim.html`.

- [ ] **Step 10: Document it in `CLAUDE.md`**

Under **Verifying**, after the `npm run motion` paragraph, add:

```markdown
The same page has a **Sound** panel. Cues named in `client/cues.ts` are
synthesized rather than found: a recipe is a list of layers, each one source
with an envelope, and its dials write back into the `cue:recipes` block through
the same Save that writes the CSS. Drag the envelope canvas rather than
inferring the shape from four sliders.

Sounds that must stay found live in `sounds/raw/`, which is gitignored — drop a
download in and it appears in the panel's Library, auditionable through the
current trim so you hear what you are about to bake in. **Adopt** runs one of
two `ffmpeg` presets, writes the result into `client/public/sounds/`, and
appends the row to `CREDITS.md` with the exact command. `ffmpeg` is a machine
binary invoked through `child_process`; it is not and must not become an npm
dependency.
```

Under **Constraints**, extend the tunables note: a number an anchor needs is either a CSS custom property in `anim:tunables` or a field in a recipe in `cue:recipes` — never inlined into either a keyframe or a scenario.

- [ ] **Step 11: Commit**

```bash
git add tools/sndlib.ts tools/sndlib.test.ts vite.config.ts client/anim/main.tsx client/sound.ts client/public/sounds/CREDITS.md CLAUDE.md
git commit -m "feat: adopt a download in one click, credits row and all"
```

---

## Verification, end to end

After Task 7, walk the whole thing once:

1. `npm test` — every suite.
2. `npm run typecheck` — clean.
3. `npm run build` — succeeds; `ls dist` shows no `anim.html`.
4. `npm start`, then `npm run probe -- value:400 join:Ada,Bo,Cy,Dee arm buzz:Ada@0,Bo@140,Cy@390,Dee@700` — four evenly spaced clicks, then `npm run probe -- clear`.
5. `npm run sim -- 3` — a believable game with sound throughout; no console errors.
6. `npm run motion` — both panels work, Save writes both files, Adopt produces a file and a credits row.
7. `git status` — `sounds/raw/` is absent.

## Notes on what this plan deliberately does not do

- **The three one-shots keep their sample files.** `cues.ts` gives `stamp`, `leader` and `leader2` recipes, which means `play()` takes the recipe branch for them — but `FILES` still lists the samples and they still ship. Deleting them is a separate decision made after the synthesized versions have been heard in a room. If the recipes turn out worse, removing the three entries from `RECIPES` restores the old behaviour exactly, which is why the sample path is left intact rather than ripped out.
- **No offline bounce.** A mixed cue is never rendered to a file; layers mix at play time.
- **No Freesound API.** Discovery stays a browser tab and a download into `sounds/raw/`.
