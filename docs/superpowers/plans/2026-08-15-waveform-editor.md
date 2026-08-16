# Waveform Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the sound panel's per-layer envelope canvas into a DAW view — every layer of a cue on one shared timeline, the audio drawn behind the envelope that gates it, layers added and removed in the UI.

**Architecture:** The harness stops accumulating flat `cue.index.field` overrides and holds a `draft` recipe tree instead, because add/remove are structural and a flat key map cannot express them. `Envelope.tsx` is absorbed into a new `Track.tsx` (one layer: waveform behind, envelope in front) stacked by `Layers.tsx` (the shared x-axis for one cue). All arithmetic — peak reduction, the axis span, drag clamps, add/remove — is pure and lives outside the components so it tests in Node.

**Tech Stack:** Preact + TypeScript, WebAudio, inline SVG, Vite dev middleware, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-15-waveform-editor-design.md`

## Global Constraints

- **Node 26.7.0, pinned via mise.** Relative imports carry `.ts` extensions. No `enum`, no `namespace`, no constructor parameter properties.
- **No CDN, no remote assets.** Everything vendored under `client/public/`.
- **Runtime dependencies are exactly `ws` and `qrcode`** (client: `preact`). This plan adds none.
- Tests use `node:test` and `node:assert/strict` only. Client tests run as `client/*.test.ts` (already in the `npm test` glob).
- Deliberate simplifications with a real ceiling carry a `ponytail:` comment naming the ceiling and the upgrade path.
- A number an anchor needs is a CSS custom property in `anim:tunables` or a field in a recipe in `cue:recipes` — never inlined into a keyframe or a scenario. Harness *chrome* dimensions (SVG viewBox, hit zones) are not anchor values and are ordinary constants.
- The harness is dev-only: `anim.html` stays out of `build.rollupOptions.input`; every new dev route is `apply: 'serve'`.
- **Layers may only reference files in `client/public/sounds/`,** never `sounds/raw/`. A recipe must never name something the real board cannot serve.
- Testing is deliberately light (pure logic only). The verification that counts is `npm run motion` plus a `npm run probe` round on the real board.

---

## Task 1: The pure core

Everything with arithmetic in it, written and tested before any pixel exists. `withOverrides` stays alive this task — `main.tsx` still imports it, and every task must end with a green `npm run typecheck`.

**Files:**
- Create: `client/peaks.ts`
- Create: `client/peaks.test.ts`
- Modify: `client/cues.ts` (add `setPath`, `span`, `clampField`, `addLayer`, `removeLayer`)
- Modify: `client/cues.test.ts` (add tests for the new functions)
- Modify: `client/sound.ts` (add `bufferFor`)

**Interfaces:**
- Consumes: `Layer`, `Recipe`, `Source` from `client/synth.ts`; `NumericField`, `NUMERIC` from `client/cues.ts`.
- Produces:
  - `peaks(data: Float32Array, width: number): Peak[]` where `Peak = { min: number; max: number }`
  - `setPath(recipes: Record<string, Recipe>, path: string, value: number): Record<string, Recipe>`
  - `span(recipe: Recipe): number` — ms
  - `clampField(field: NumericField, value: number, maxHead?: number): number`
  - `addLayer(recipe: Recipe, source: Source, durationMs?: number): Recipe`
  - `removeLayer(recipe: Recipe, i: number): Recipe`
  - `bufferFor(url: string): AudioBuffer | undefined` from `client/sound.ts`

- [ ] **Step 1: Write the failing tests for `peaks`**

Create `client/peaks.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { peaks } from './peaks.ts'

test('one min/max column per requested width', () => {
  const data = new Float32Array(100).fill(0.5)
  assert.equal(peaks(data, 20).length, 20)
  assert.equal(peaks(data, 1).length, 1)
})

test('a column carries the extremes of the samples under it', () => {
  const data = new Float32Array([0, 1, -1, 0, 0.25, -0.25, 0, 0])
  const [a, b] = peaks(data, 2)
  assert.deepEqual(a, { min: -1, max: 1 })
  assert.deepEqual(b, { min: -0.25, max: 0.25 })
})

test('silence stays flat', () => {
  const out = peaks(new Float32Array(64), 8)
  for (const p of out) assert.deepEqual(p, { min: 0, max: 0 })
})

// The draw width is pixels and the file may be shorter than the panel is wide.
// Every column still has to carry a value, or the path string has a hole in it.
test('a width larger than the sample count still fills every column', () => {
  const out = peaks(new Float32Array([1, -1]), 6)
  assert.equal(out.length, 6)
  for (const p of out) assert.ok(Number.isFinite(p.min) && Number.isFinite(p.max))
})

test('an empty buffer is flat rather than NaN', () => {
  assert.deepEqual(peaks(new Float32Array(0), 3), [
    { min: 0, max: 0 },
    { min: 0, max: 0 },
    { min: 0, max: 0 },
  ])
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test client/peaks.test.ts`
Expected: FAIL — `Cannot find module './peaks.ts'`

- [ ] **Step 3: Write `client/peaks.ts`**

```ts
/**
 * A waveform reduced to what a column of pixels can show.
 *
 * One min/max pair per column, which is how every editor draws audio: a column
 * is a vertical line from the quietest sample under it to the loudest, so a
 * click a hundred samples wide still reaches full height at any zoom.
 *
 * Pure, so the drawing can be checked without a browser or a decoder.
 *
 * ponytail: reduced at the draw width, recomputed on resize. No cached
 * multi-resolution pyramid — these files are seconds long, not hours. Build one
 * if a cue ever holds a full song.
 */
export type Peak = { min: number; max: number }

export function peaks(data: Float32Array, width: number): Peak[] {
  const n = Math.max(1, Math.floor(width))
  const out: Peak[] = []
  for (let c = 0; c < n; c++) {
    const from = Math.floor((c * data.length) / n)
    // At least one sample per column even when the file is shorter than the
    // panel is wide, so a column never comes back as the empty -Infinity pair.
    const to = Math.min(data.length, Math.max(from + 1, Math.floor(((c + 1) * data.length) / n)))
    let min = 0
    let max = 0
    for (let i = from; i < to; i++) {
      const v = data[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    out.push({ min, max })
  }
  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test client/peaks.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing tests for the recipe helpers**

Append to `client/cues.test.ts` (leave the existing tests, including the `withOverrides` ones, untouched — Task 2 deletes those):

```ts
import { addLayer, clampField, removeLayer, setPath, span } from './cues.ts'

test('setPath writes one field and leaves the source table alone', () => {
  const out = setPath(SAMPLE, 'stamp.1.freq', 1200)
  assert.equal(out.stamp[1].freq, 1200)
  assert.equal(SAMPLE.stamp[1].freq, 900, 'the source table was mutated')
})

// The canvas draws every handle whatever the recipe declares, so a drag on a
// layer with no hold has to be able to give it one.
test('setPath can introduce a field the layer omits', () => {
  assert.equal(setPath(SAMPLE, 'stamp.0.hold', 120).stamp[0].hold, 120)
})

test('setPath naming nothing real returns the table unchanged', () => {
  assert.equal(setPath(SAMPLE, 'stamp.9.freq', 1), SAMPLE)
  assert.equal(setPath(SAMPLE, 'stamp.0.nope', 1), SAMPLE)
  assert.equal(setPath(SAMPLE, 'junk', 1), SAMPLE)
})

test('span is the longest layer end, delay included', () => {
  assert.equal(span([{ source: 'sine', attack: 10, decay: 90 }]), 100)
  // The second layer is shorter but starts late enough to finish last.
  assert.equal(
    span([
      { source: 'sine', attack: 10, decay: 90 },
      { source: 'noise', delay: 200, decay: 50 },
    ]),
    250,
  )
  assert.ok(span([]) > 0, 'an empty cue still needs a divisible axis')
})

test('clamps: nothing negative, sustain is a level, head cannot pass the file', () => {
  assert.equal(clampField('attack', -30), 0)
  assert.equal(clampField('hold', 120.6), 121)
  assert.equal(clampField('sustain', 1.4), 1)
  assert.equal(clampField('sustain', -0.2), 0)
  assert.equal(clampField('head', 900, 400), 400)
  assert.equal(clampField('head', 120, 400), 120)
})

test('a new file layer plays whole the moment it is added', () => {
  const out = addLayer([], { file: '/sounds/stamp.wav' }, 216)
  assert.equal(out.length, 1)
  assert.deepEqual(out[0].source, { file: '/sounds/stamp.wav' })
  assert.equal(out[0].sustain, 1, 'no sustain means the layer is silent')
  assert.equal(out[0].hold, 216, 'the envelope must cover the whole file')
})

test('a new oscillator layer is an audible pluck', () => {
  const [l] = addLayer([], 'sine')
  assert.equal(l.source, 'sine')
  assert.ok((l.decay ?? 0) > 0, 'a layer with no stages is silent')
  assert.ok((l.freq ?? 0) > 0)
})

test('removeLayer drops one and copies the rest', () => {
  const src: Recipe = [{ source: 'sine' }, { source: 'noise' }]
  const out = removeLayer(src, 0)
  assert.deepEqual(out, [{ source: 'noise' }])
  assert.equal(src.length, 2, 'the source recipe was mutated')
})
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `node --test client/cues.test.ts`
Expected: FAIL — `The requested module './cues.ts' does not provide an export named 'setPath'`

- [ ] **Step 7: Add the helpers to `client/cues.ts`**

Add below `withOverrides` (which stays until Task 2). The file already imports `type { Layer, Recipe }`; extend that import to `import type { Layer, Recipe, Source } from './synth.ts'`.

```ts
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
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test client/cues.test.ts`
Expected: PASS — the new tests plus the existing ones.

- [ ] **Step 9: Add `bufferFor` to `client/sound.ts`**

Directly below the `primeFile` function (which ends around line 104):

```ts
/**
 * The decoded bytes behind a `{ file }` layer, for anything that needs to look
 * at the audio rather than play it — which today is the harness drawing a
 * waveform. Nothing is fetched: this reads what `primeFile` already landed, and
 * a miss means the decode has not finished, which the caller draws as an empty
 * track rather than waiting on.
 */
export function bufferFor(url: string): AudioBuffer | undefined {
  return files.get(url)
}
```

- [ ] **Step 10: Typecheck and commit**

```bash
npm run typecheck && npm test
git add client/peaks.ts client/peaks.test.ts client/cues.ts client/cues.test.ts client/sound.ts
git commit -m "feat: pure core for the waveform editor — peaks, span, clamps, add/remove"
```

---

## Task 2: The harness holds a draft tree

No visual change yet. The harness stops accumulating flat overrides and holds the recipe tree, which is what makes add and remove possible at all. `Envelope.tsx` keeps rendering, now driven from the draft.

**Files:**
- Modify: `client/anim/main.tsx` (draft state, dial reads/writes, save body, reset)
- Modify: `client/anim/scenarios.tsx:122-133` (`recipeDials` takes a recipe) and its three call sites at lines 231, 251, 253
- Modify: `client/cues.ts` (delete `withOverrides`)
- Modify: `client/cues.test.ts` (delete the four `withOverrides` tests)

**Interfaces:**
- Consumes: `setPath`, `getPath`, `RECIPES` from `client/cues.ts`; `Dial`, `dialKey` from `./scenarios.tsx`.
- Produces:
  - `recipeDials(cue: string, recipe: Recipe): Dial[]` — signature change; the recipe is now passed in rather than read from the committed table.
  - Inside `main.tsx`: `draft: Record<string, Recipe>` state and `setDraft`. Tasks 3 and 4 render against `draft[cue]` and mutate through `setDraft`.
  - Inside `main.tsx`: `cues: Cue[]` — `[scenario.sound ?? []].flat()`, the cue list every downstream loop walks.

- [ ] **Step 1: Change `recipeDials` to take the recipe**

In `client/anim/scenarios.tsx`, replace the body of `recipeDials` (line 122) and extend its doc comment:

```ts
/**
 * Every numeric field actually present in a cue's recipe, as dials.
 *
 * Driven off the recipe passed in rather than off the committed table, because
 * the harness now edits a draft: a layer you added a moment ago has to get its
 * dials without a reload, and a layer you removed has to lose them.
 */
export function recipeDials(cue: string, recipe: Recipe): Dial[] {
  return recipe.flatMap((layer, i) =>
    NUMERIC.filter((f) => typeof layer[f] === 'number').map((f) => ({
      recipe: `${cue}.${i}.${f}`,
      label: `${cue} L${i + 1} ${f}`,
      min: 0,
      ...FIELD[f],
    })),
  )
}
```

Change the import at the top of the file from `import type { Layer } from '../synth.ts'` to `import type { Recipe } from '../synth.ts'`, and drop `RECIPES` from the `../cues.ts` import if nothing else in the file uses it (`soundDials` still does — check before removing).

- [ ] **Step 2: Drop the static recipe dials from the scenarios**

`main.tsx` composes them per render instead. In `client/anim/scenarios.tsx`:
- line 231: delete `...recipeDials('stamp'), ` from the `dials` array.
- lines 251 and 253: delete the `...recipeDials('leader'),` and `...recipeDials('leader2'),` entries.

- [ ] **Step 3: Hold the draft in `main.tsx`**

In `client/anim/main.tsx`, replace the imports on lines 27-28:

```ts
import { RECIPES, getPath, setPath } from '../cues.ts'
import { recipeDials } from './scenarios.tsx'
```

(`recipeDials` joins the existing `./scenarios.tsx` import — merge it into that line rather than adding a second import of the same module.)

Then, immediately after the `origin` state (line 74), add:

```ts
  /**
   * The recipes as they are being edited, seeded from what is committed.
   *
   * A tree rather than the flat `cue.index.field` overrides it replaces,
   * because add and remove are structural: override keys name a layer by
   * position, so removing layer 0 silently retargets every key naming layer 1.
   * Stable per-layer ids would fix that at the cost of writing UI bookkeeping
   * into committed data. Nothing here is written to disk until Save, which is
   * what makes Reset able to bring a deleted layer back.
   */
  const [draft, setDraft] = useState<Record<string, Recipe>>(() => structuredClone(RECIPES))
```

Add `Recipe` to the type import from `../synth.ts` (add the import if the file has none: `import type { Recipe } from '../synth.ts'`).

- [ ] **Step 4: Point everything that read `live` at `draft`**

- Delete the `const live = withOverrides(RECIPES, values)` line (180) and its comment block (175-179), replacing it with the cue list every loop below walks:

```ts
  // Every cue this scenario fires. The draft, not the committed table, is what
  // the harness plays and draws — a sound tuned against the file while you
  // watch the slider would be tuning nothing.
  const cues = [scenario.sound ?? []].flat()
```

- In the trigger effect (190-198), `recipe: live[cue]` becomes `recipe: draft[cue]`.
- In the priming effect (210-214), `live[cue]` becomes `draft[cue]`, and the dependency array becomes `[id, draft]`.
- Delete the `cssValues` filter (219-221) and its comment (216-218); `values` holds only CSS properties again. Replace every later use of `cssValues` with `values` — the `css` preview string (223-228) and the stage's `style={cssValues}` (576).
- In `save` (230-247), delete the local `const css = Object.fromEntries(...)` filter line and post the draft:

```ts
        body: JSON.stringify({ css: values, recipes: draft }),
```

- [ ] **Step 5: Compose the dial list and split the two dial kinds**

Replace the envelope block (426-436) and the dial loop opening (437) so that recipe dials come from the draft. Above the returned JSX, add:

```ts
  // CSS dials come from the scenario; recipe dials come from the draft, so a
  // layer added a moment ago has its dials without a reload.
  const dials = [...scenario.dials, ...cues.flatMap((c) => recipeDials(c, draft[c] ?? []))]
```

Change the loop header from `{scenario.dials.map((d) => {` to `{dials.map((d) => {`, and inside it replace the three lines that read and write a value:

```ts
          const k = dialKey(d)
          const recipe = 'recipe' in d
          const was = recipe ? String(getPath(RECIPES, d.recipe) ?? 0) : origin[k] ?? ''
          const now = recipe ? String(getPath(draft, d.recipe) ?? 0) : values[k] ?? ''
          const moved = now !== was
          const back = () =>
            recipe
              ? setDraft((t) => setPath(t, d.recipe, parseFloat(was)))
              : setValues((v) => ({ ...v, [k]: was }))
```

and the range input's `onInput` (490-500):

```ts
                  onInput={(e) => {
                    const raw = (e.target as HTMLInputElement).value
                    if ('recipe' in d) setDraft((t) => setPath(t, d.recipe, parseFloat(raw)))
                    else setValues((v) => ({ ...v, [k]: `${raw}${d.unit}` }))
                  }}
```

`readDefaults` (49-56) now only ever sees CSS dials, so simplify its body to the `var` branch and drop its `getPath` use:

```ts
function readDefaults(dials: Dial[]): Record<string, string> {
  const root = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const d of dials) if ('var' in d) out[dialKey(d)] = root.getPropertyValue(d.var).trim()
  return out
}
```

- [ ] **Step 6: Reset brings the tree back too**

Replace the "Reset all" button (522-531):

```ts
          <button
            class="btn btn--ghost"
            disabled={
              !scenario.dials.some((d) => values[dialKey(d)] !== origin[dialKey(d)]) &&
              JSON.stringify(draft) === JSON.stringify(RECIPES)
            }
            onClick={() => {
              setValues({ ...origin })
              setDraft(structuredClone(RECIPES))
              trigger()
            }}
          >
            Reset all
          </button>
```

And in `save`, after a successful response, the draft is the new baseline the same way `origin` is — no code needed, because a successful save rewrites `cues.ts` and the next reload re-seeds from it. Add one line to the success branch so it says so:

```ts
      // The recipe baseline re-seeds on reload rather than here: Save has just
      // rewritten cues.ts, and the module's RECIPES in this page's memory is the
      // pre-save one. Reset before a reload therefore goes back to what the file
      // held when the page opened, which is the honest thing for it to mean.
```

Keep the existing envelope rendering for now, reading from the draft — replace the block at 426-436:

```ts
        {cues.map((cue) =>
          (draft[cue] ?? []).map((layer, i) => (
            <Envelope
              key={`${cue}.${i}`}
              layer={layer}
              onChange={(field, value) => setDraft((t) => setPath(t, `${cue}.${i}.${field}`, value))}
            />
          )),
        )}
```

- [ ] **Step 7: Delete `withOverrides` and its tests**

In `client/cues.ts`, delete the whole `withOverrides` function and its doc comment (lines 83-106). `FIELDS` stays — `setPath` uses it.

In `client/cues.test.ts`, delete these three tests and drop `withOverrides` from the import:
- `'overrides produce a new table and leave the original alone'`
- `'an override that names nothing real is ignored rather than thrown'`
- `'a field the recipe omits can still be dialled in'`

(Their replacements landed in Task 1 as the `setPath` tests.)

- [ ] **Step 8: Verify**

```bash
npm run typecheck && npm test
```
Expected: clean typecheck, all tests pass, no reference to `withOverrides` anywhere:

```bash
grep -rn "withOverrides\|cssValues" client/ && echo "STILL REFERENCED — fix before committing"
```
Expected: no matches.

- [ ] **Step 9: Check it in the harness**

Run `npm run motion`, pick the Stamp scenario, drag an envelope handle and a recipe slider, hear the change, hit Reset all and confirm the numbers snap back. Nothing should look different from before this task.

- [ ] **Step 10: Commit**

```bash
git add client/anim/main.tsx client/anim/scenarios.tsx client/cues.ts client/cues.test.ts
git commit -m "refactor: the harness edits a recipe draft instead of flat overrides"
```

---

## Task 3: The DAW view

`Envelope.tsx` becomes `Track.tsx` — the same handle math, now over a waveform, on an axis it does not own. `Layers.tsx` owns that axis.

**Files:**
- Create: `client/anim/Track.tsx`
- Create: `client/anim/Layers.tsx`
- Delete: `client/anim/Envelope.tsx`
- Modify: `client/anim/main.tsx` (render `Layers` per cue)
- Modify: `client/style.css` (track chrome, outside the `anim:tunables` markers)

**Interfaces:**
- Consumes: `peaks`/`Peak` from `client/peaks.ts`; `span`, `setPath`, `clampField` from `client/cues.ts`; `bufferFor` from `client/sound.ts`; `Layer`, `Recipe` from `client/synth.ts`.
- Produces:
  - `Track({ layer, spanMs, onChange, onRemove }: { layer: Layer; spanMs: number; onChange: (field: NumericField, value: number) => void; onRemove: () => void })`
  - `Layers({ cue, recipe, onChange, onAdd, onRemove }: { cue: string; recipe: Recipe; onChange: (i: number, field: NumericField, value: number) => void; onAdd: (source: Source, durationMs: number) => void; onRemove: (i: number) => void })` — the `onAdd` prop is wired to a real picker in Task 4; this task renders the tracks and leaves `+ layer` out.

- [ ] **Step 1: Write `client/anim/Track.tsx`**

```tsx
/**
 * One layer of a cue: the audio behind, the envelope that gates it in front,
 * both on an axis the track does not own.
 *
 * This is the old `Envelope.tsx` with the waveform it was always missing. The
 * handle math is unchanged — drag as a delta, never to an absolute position,
 * because a handle's absolute x is the sum of every stage before it and reading
 * a position would make the handle jump to the cursor on grab.
 *
 * ponytail: no zoom, no snapping, no curve shaping, mono only. The axis is the
 * cue's own length and the harness's speed slider is the release valve for a
 * 40ms click beside a 3s bed. Add zoom when a cue actually needs it.
 */
import { useRef } from 'preact/hooks'
import { clampField } from '../cues.ts'
import { peaks } from '../peaks.ts'
import { bufferFor } from '../sound.ts'
import type { Layer } from '../synth.ts'
import type { NumericField } from '../cues.ts'

const W = 520
const H = 72
const PAD = 8
/** Columns of waveform drawn across the full width. Chrome, not a tunable. */
const COLS = 260
/**
 * How close to the clip's left edge a press means "slide the audio" rather than
 * "move the layer". Audacity's rule, and measured in pixels because it is a
 * pointing target rather than a duration.
 */
const EDGE_PX = 6

type Handle = { field: NumericField; x: number; y: number; level: boolean }

export function Track({
  layer,
  spanMs,
  onChange,
  onRemove,
}: {
  layer: Layer
  spanMs: number
  onChange: (field: NumericField, value: number) => void
  onRemove: () => void
}) {
  const box = useRef<SVGSVGElement>(null)
  const d0 = layer.delay ?? 0
  const a = layer.attack ?? 0
  const d = layer.decay ?? 0
  const h = layer.hold ?? 0
  const r = layer.release ?? 0
  const s = layer.sustain ?? 0
  const end = d0 + a + d + h + r

  const x = (t: number) => PAD + (t / spanMs) * (W - PAD * 2)
  const y = (v: number) => H - PAD - v * (H - PAD * 2)

  const file = typeof layer.source === 'object' ? layer.source.file : null
  const buf = file ? bufferFor(file) : undefined
  const durMs = buf ? buf.duration * 1000 : 0
  const head = layer.head ?? 0

  /**
   * The audio, as two paths: the part the envelope lets through and the part it
   * gates off. Drawing the tail dimmed rather than clipping it away is the
   * reason to draw a waveform at all — you can see what you are cutting, and
   * drag it back.
   *
   * One path per side rather than a rect per column: a few hundred SVG nodes
   * that re-render on every pointermove is the difference between a smooth drag
   * and a slideshow.
   */
  let lit = ''
  let dim = ''
  if (buf) {
    const data = buf.getChannelData(0)
    const from = Math.min(data.length, Math.floor((head / 1000) * buf.sampleRate))
    const visible = data.subarray(from)
    const cols = peaks(visible, COLS)
    const audioMs = Math.max(0, durMs - head)
    const mid = (H - PAD * 2) / 2 + PAD
    const half = (H - PAD * 2) / 2
    for (let c = 0; c < cols.length; c++) {
      const t = d0 + (c / cols.length) * audioMs
      if (t > spanMs) break
      const px = x(t).toFixed(2)
      const top = (mid - cols[c].max * half).toFixed(2)
      const bot = (mid - cols[c].min * half).toFixed(2)
      const seg = `M${px} ${top}V${bot}`
      if (t <= end) lit += seg
      else dim += seg
    }
  }

  const handles: Handle[] = [
    { field: 'attack', x: x(d0 + a), y: y(1), level: false },
    { field: 'decay', x: x(d0 + a + d), y: y(s), level: true },
    { field: 'hold', x: x(d0 + a + d + h), y: y(s), level: false },
    { field: 'release', x: x(end), y: y(0), level: false },
  ]
  const points = `${x(d0)},${y(0)} ${handles.map((p) => `${p.x},${p.y}`).join(' ')}`

  /** ms per client pixel, accounting for however wide the SVG actually laid out. */
  const perPx = () => {
    const rect = box.current!.getBoundingClientRect()
    return spanMs / ((W - PAD * 2) * (rect.width / W))
  }

  /**
   * One drag, one field. Everything on this track is the same gesture with a
   * different field under it, so there is one implementation: capture where the
   * pointer and the value started, then move the value by the delta.
   */
  const drag = (e: PointerEvent, field: NumericField, alsoLevel = false) => {
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    const rect = box.current!.getBoundingClientRect()
    const scale = perPx()
    const from = { x: e.clientX, y: e.clientY, v: layer[field] ?? 0, s }

    const move = (m: PointerEvent) => {
      onChange(field, clampField(field, from.v + (m.clientX - from.x) * scale, durMs))
      if (alsoLevel) {
        const dy = (m.clientY - from.y) / (rect.height * ((H - PAD * 2) / H))
        onChange('sustain', clampField('sustain', from.s - dy))
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * The body drag and the clip's left edge share a boundary, so the edge wins
   * inside its hit zone and the body takes everything else. Same rule Audacity
   * uses: near the edge you are trimming, anywhere else you are moving.
   */
  const grabBody = (e: PointerEvent) => {
    const rect = box.current!.getBoundingClientRect()
    const clipLeft = rect.left + (x(d0) / W) * rect.width
    if (file && Math.abs(e.clientX - clipLeft) <= EDGE_PX) drag(e, 'head')
    else drag(e, 'delay')
  }

  return (
    <div class="track">
      <svg
        ref={box}
        class="track__canvas"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={file ?? String(layer.source)}
        onPointerDown={(e) => grabBody(e as unknown as PointerEvent)}
      >
        <path class="track__wave" d={lit} />
        <path class="track__wave track__wave--gated" d={dim} />
        <polyline class="track__env" points={points} />
        {handles.map((hnd) => (
          <circle
            key={hnd.field}
            class="track__handle"
            cx={hnd.x}
            cy={hnd.y}
            r={6}
            onPointerDown={(e) => {
              // Stops `grabBody` from also starting a delay drag underneath.
              e.stopPropagation()
              drag(e as unknown as PointerEvent, hnd.field, hnd.level)
            }}
          >
            <title>{hnd.field}</title>
          </circle>
        ))}
      </svg>
      <button class="track__remove" title="remove layer" onClick={onRemove}>
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Write `client/anim/Layers.tsx`**

```tsx
/**
 * Every layer of one cue on one shared timeline.
 *
 * The shared axis is the whole point: scaling each layer to its own length
 * makes two layers of different lengths incomparable, which is exactly what
 * matters when you are combining two sounds. The span is recomputed from the
 * recipe on every render, so it grows under you as you drag a layer later.
 *
 * ponytail: no cross-cue view — one cue at a time, which is what a scenario
 * shows anyway.
 */
import { span } from '../cues.ts'
import { Track } from './Track.tsx'
import type { NumericField } from '../cues.ts'
import type { Recipe } from '../synth.ts'

/** Ruler steps, coarsest first. The first one that yields ≤8 marks wins. */
const STEPS = [2000, 1000, 500, 250, 100, 50, 25, 10]

export function Layers({
  cue,
  recipe,
  onChange,
  onRemove,
}: {
  cue: string
  recipe: Recipe
  onChange: (i: number, field: NumericField, value: number) => void
  onRemove: (i: number) => void
}) {
  const spanMs = span(recipe)
  const step = STEPS.find((s) => spanMs / s <= 8) ?? STEPS[STEPS.length - 1]
  const ticks: number[] = []
  for (let t = 0; t <= spanMs; t += step) ticks.push(t)

  return (
    <div class="layers">
      <div class="layers__head">
        <span class="eyebrow">{cue}</span>
        <span class="readout">{Math.round(spanMs)}ms</span>
      </div>
      <div class="layers__ruler">
        {ticks.map((t) => (
          <span key={t} class="layers__tick" style={{ left: `${(t / spanMs) * 100}%` }}>
            {t}
          </span>
        ))}
      </div>
      {recipe.map((layer, i) => (
        <Track
          key={i}
          layer={layer}
          spanMs={spanMs}
          onChange={(field, value) => onChange(i, field, value)}
          onRemove={() => onRemove(i)}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Render it from `main.tsx` and delete `Envelope.tsx`**

Replace the `import { Envelope } from './Envelope.tsx'` line with `import { Layers } from './Layers.tsx'`, and replace the envelope block from Task 2 Step 6 with:

```tsx
        {cues.map((cue) => (
          <Layers
            key={cue}
            cue={cue}
            recipe={draft[cue] ?? []}
            onChange={(i, field, value) =>
              setDraft((t) => setPath(t, `${cue}.${i}.${field}`, value))
            }
            onRemove={(i) =>
              setDraft((t) => ({ ...t, [cue]: removeLayer(t[cue] ?? [], i) }))
            }
          />
        ))}
```

Add `removeLayer` to the `../cues.ts` import. Then:

```bash
git rm client/anim/Envelope.tsx
```

- [ ] **Step 4: Style the tracks**

In `client/style.css`, replace the `.envelope*` block (currently lines 1000-1019, headed `/* --- the harness envelope canvas --- */`) with the track chrome. This is outside the `anim:tunables` markers and stays outside them — it is harness chrome, not a value the board reads.

```css
/* --- the harness waveform editor -------------------------------------- */
.layers {
  margin-block: var(--s-3);
}
.layers__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.layers__ruler {
  position: relative;
  height: 1rem;
  font-size: var(--t-xs, 0.7rem);
  color: var(--chalk-dim, #7a8794);
}
.layers__tick {
  position: absolute;
  transform: translateX(-50%);
}
.track {
  position: relative;
}
.track__canvas {
  width: 100%;
  height: auto;
  background: var(--surface-2, #0e1116);
  border-radius: 6px;
  touch-action: none;
  cursor: grab;
}
.track__wave {
  stroke: var(--chalk-dim, #7a8794);
  stroke-width: 1;
}
.track__wave--gated {
  opacity: 0.28;
}
.track__env {
  fill: none;
  stroke: var(--accent, #4dd6e8);
  stroke-width: 2;
  pointer-events: none;
}
.track__handle {
  fill: var(--accent, #4dd6e8);
  cursor: ew-resize;
}
.track__handle:hover {
  fill: #fff;
}
.track__remove {
  position: absolute;
  top: 2px;
  right: 2px;
  border: 0;
  background: transparent;
  color: var(--chalk-dim, #7a8794);
  cursor: pointer;
  line-height: 1;
}
.track__remove:hover {
  color: #fff;
}
```

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npm test
grep -rn "Envelope" client/ && echo "STILL REFERENCED — fix before committing"
```
Expected: clean typecheck, tests pass, no `Envelope` matches.

- [ ] **Step 6: Check it in the harness**

`npm run motion`, Stamp scenario. Confirm, in this order:
1. The waveform for `/sounds/stamp.wav` is drawn (it may take one retrigger — the decode has to land first).
2. Dragging the release handle left dims the tail rather than erasing it.
3. Dragging the track body sideways moves the clip and the envelope together, and the ruler's span grows.
4. Pressing within 6px of the clip's left edge slides the audio inside the clip instead of moving it.
5. The Leader scenario shows `leader` and `leader2` as two `Layers` blocks, each on its own span.

- [ ] **Step 7: Commit**

```bash
git add client/anim/Track.tsx client/anim/Layers.tsx client/anim/main.tsx client/style.css client/anim/Envelope.tsx
git commit -m "feat: the sound panel is a waveform editor on a shared timeline"
```

---

## Task 4: The front door

`+ layer` with a source picker, listing the files the board can actually serve.

**Files:**
- Modify: `vite.config.ts` (add `/__snd/adopted` to `sndLibrary()`)
- Modify: `client/anim/Layers.tsx` (picker, `onAdd`)
- Modify: `client/anim/main.tsx` (wire `onAdd` to `addLayer`)
- Modify: `client/style.css` (picker chrome)

**Interfaces:**
- Consumes: `addLayer` from `client/cues.ts`; `primeFile`, `bufferFor` from `client/sound.ts`.
- Produces: `GET /__snd/adopted` → `{ files: { name: string; size: number }[] }`, names relative to `client/public/sounds/`, servable as `/sounds/<name>`.

- [ ] **Step 1: Add the adopted listing route**

In `vite.config.ts`, inside `sndLibrary()`'s `configureServer`, directly above the `/__snd/raw` middleware:

```ts
      /**
       * What a layer is allowed to point at.
       *
       * Adopted files only, never the holding ground: anything a recipe names
       * has to be servable to the real board, or the harness will happily show
       * you a cue that goes silent in production. That has already happened
       * once on this codebase.
       */
      server.middlewares.use('/__snd/adopted', async (_req, res) => {
        res.setHeader('content-type', 'application/json')
        try {
          const names = await readdir(OUT)
          const files = []
          for (const name of names) {
            if (!/\.(wav|ogg)$/i.test(name)) continue
            const s = await stat(resolve(OUT, name))
            files.push({ name, size: s.size })
          }
          files.sort((a, b) => a.name.localeCompare(b.name))
          res.end(JSON.stringify({ files }))
        } catch {
          res.end(JSON.stringify({ files: [] }))
        }
      })
```

`readdir`, `stat` and `resolve` are already imported at the top of the file, and `OUT` is already defined at line 22. The extension filter is the guard here rather than `safeOut`: `safeOut` validates a *proposed* name for writing, and a file already sitting in `client/public/sounds/` is by definition one the board serves.

Verify it with the dev server running:

```bash
npm run dev &
sleep 3 && curl -s localhost:5173/__snd/adopted
```
Expected: `{"files":[{"name":"leader.wav",...},{"name":"leader2.wav",...},{"name":"stamp.wav",...},{"name":"welcome.ogg",...}]}`

- [ ] **Step 2: Add the picker to `Layers.tsx`**

Add to the imports:

```ts
import { useEffect, useState } from 'preact/hooks'
import { bufferFor, primeFile } from '../sound.ts'
import type { Source } from '../synth.ts'
```

Add the oscillator list above the component:

```ts
/**
 * The sources a layer may take. Files come from the server; the oscillators are
 * a literal because there are five of them and there always will be — the
 * picker was needed for files regardless, so covering them costs an array.
 */
const OSCILLATORS: Source[] = ['sine', 'square', 'sawtooth', 'triangle', 'noise']
```

Extend the props with `onAdd: (source: Source, durationMs: number) => void`, and add inside the component:

```ts
  const [picking, setPicking] = useState(false)
  const [adopted, setAdopted] = useState<{ name: string }[]>([])
  useEffect(() => {
    fetch('/__snd/adopted')
      .then((r) => r.json())
      .then((b) => setAdopted(b.files))
      .catch(() => {})
  }, [])

  /**
   * Decode before adding, so the new layer's `hold` can be the file's real
   * length. A file layer is gated like any other and one with no stages is
   * silent — this default is what stops the front door from handing you a
   * layer that does nothing.
   */
  const addFile = async (name: string) => {
    const url = `/sounds/${name}`
    await primeFile(url)
    onAdd({ file: url }, (bufferFor(url)?.duration ?? 0) * 1000)
    setPicking(false)
  }
```

And render it below the track list, inside the `.layers` div:

```tsx
      <div class="harness__row">
        <button class="btn btn--ghost" onClick={() => setPicking((p) => !p)}>
          + layer
        </button>
      </div>
      {picking && (
        <div class="layers__picker">
          {adopted.map((f) => (
            <button key={f.name} class="btn" onClick={() => addFile(f.name)}>
              {f.name}
            </button>
          ))}
          {OSCILLATORS.map((o) => (
            <button
              key={String(o)}
              class="btn"
              onClick={() => {
                onAdd(o, 0)
                setPicking(false)
              }}
            >
              {String(o)}
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 3: Wire `onAdd` in `main.tsx`**

Add `addLayer` to the `../cues.ts` import and give `<Layers>` the prop:

```tsx
            onAdd={(source, durationMs) =>
              setDraft((t) => ({ ...t, [cue]: addLayer(t[cue] ?? [], source, durationMs) }))
            }
```

- [ ] **Step 4: Style the picker**

Append to the waveform-editor block in `client/style.css`:

```css
.layers__picker {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-1, 0.25rem);
  padding-block: var(--s-1, 0.25rem);
}
```

- [ ] **Step 5: Verify**

```bash
npm run typecheck && npm test
```

Then in `npm run motion`, on the Stamp scenario:
1. `+ layer` → `leader.wav`. A second track appears with a waveform, and Retrigger plays both.
2. The new layer's sliders appear in the dial list below (`stamp L2 hold`, `stamp L2 release`, …) — this is the Task 2 dial composition proving itself.
3. `+ layer` → `sine`. It is audible on retrigger, and its `freq` dial is there to move.
4. `×` on a track removes it; Reset all brings every removed layer back.
5. The picker lists nothing from `sounds/raw/`.

- [ ] **Step 6: Commit**

```bash
git add vite.config.ts client/anim/Layers.tsx client/anim/main.tsx client/style.css
git commit -m "feat: add and remove cue layers from the panel"
```

---

## Task 5: Save, prove it on the board, document it

The harness and the board have now disagreed twice, and both times the harness looked correct. This task is the one that catches the third time.

**Files:**
- Modify: `CLAUDE.md` (the harness paragraph)
- Possibly modify: `client/cues.ts` (only if a save round-trip is what you commit)

- [ ] **Step 1: Save a real edit**

With `npm run motion` running: on the Stamp scenario, add a second layer, move a handle, and click **Save to style.css**. Expected: the status line reads `saved N to style.css, 3 cues`.

- [ ] **Step 2: Confirm the file took the tree**

```bash
git diff client/cues.ts
```
Expected: the `cue:recipes` block regenerated with the new layer inside it, the prose outside the markers untouched, and the `satisfies Record<string, Recipe>` suffix intact.

```bash
npm run typecheck && npm test
```
Expected: clean. If `each anchor cue is one file layer over its own WAV` fails, that is the test doing its job — it asserts the anchor cues are single-layer. Revert the experiment with `git checkout client/cues.ts` unless you actually meant to ship the extra layer.

- [ ] **Step 3: Prove it on the board**

The harness plays through the same `play()` the board does, but only the board proves the file it names is servable.

```bash
git checkout client/cues.ts   # if you have not already
npm run build
npm start                      # in one terminal
npm run probe -- join:Ada,Bo arm buzz:Ada@0,Bo@140 correct
```
Expected: the stamp and leader cues sound exactly as they did before this branch — the three anchor WAVs are untouched by all of it. Then `npm run probe -- clear`.

- [ ] **Step 4: Document it in CLAUDE.md**

In the `## Verifying` section, replace the paragraph beginning "The same page has a **Sound** panel." with:

```markdown
The same page has a **Sound** panel. Cues named in `client/cues.ts` are
synthesized rather than found: a recipe is a list of layers, each one source
with an envelope, and the panel shows them as a DAW would — every layer of a
cue on one shared timeline, the audio drawn behind the envelope that gates it.
Drag the track body to move a layer in time, drag within a few pixels of the
clip's left edge to slide the audio inside it, drag the four handles for the
envelope. Audio past the envelope's end is dimmed rather than cut, so the tail
you gated off stays visible and draggable back. `+ layer` adds a source —
an adopted file or one of five oscillators — and `×` removes one; both are
undone by Reset, because nothing is written until Save. Save writes the whole
`cue:recipes` block through the same endpoint that writes the CSS.

A layer may only name a file in `client/public/sounds/`, never one in
`sounds/raw/`: anything a recipe names has to be servable to the real board.
Using a download means adopting it first.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: the sound panel is a waveform editor"
```

---

## What this plan deliberately does not test

Per the repo's testing posture: the pure arithmetic is covered (`peaks`, `span`, `setPath`, `clampField`, `addLayer`/`removeLayer`), and nothing else is. Uncovered on purpose:

- **Pointer drags and hit zones.** No DOM in `node:test`, and adding one is a dependency. Covered by the harness pass in Task 3 Step 6.
- **Waveform path generation.** WebAudio decoding, unreachable in Node. Its arithmetic half is `peaks`, which is tested.
- **The `/__snd/adopted` route.** One `readdir` and a filter; the curl in Task 4 Step 1 is the check.

Worth adding only if a bug actually lands in one of them.
