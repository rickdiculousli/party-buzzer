# Interest Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable kit of motion and flair effects (entrances, exits, loops, hits, text effects, particles) with rules, docs, and a preview gallery in the motion harness.

**Architecture:** Effects are CSS classes in a new `FX` section of `client/style.css`, with per-effect defaults in the existing `anim:tunables` block so the harness can tune and save them. Three Preact helpers in `client/fx.tsx` (`Letters`, `Burst`, `CountUp`) cover what CSS alone cannot; their logic lives in pure `client/fx.ts` so Node can test it. The gallery is one generated harness scenario per effect.

**Tech Stack:** Preact, plain CSS custom properties and keyframes, `node --test`, Vite motion harness (`npm run motion`).

**Spec:** `docs/superpowers/specs/2026-09-18-interest-kit-design.md`

## Global Constraints

- No new dependencies.
- Effects animate only `transform`, `opacity`, `filter` (plus `background-position` for `fx-shine`); never layout properties.
- Effects never use cyan, the measurement colour. Multicolour effects (rainbow, confetti, glitch) use the effect palette `--fx-1`…`--fx-8`; glows and sparks use `--hot`, `--tungsten`, `--brass`, `--tally`, `--dim`. Player colours `--id-*` appear only when an effect is about a specific player, set by the caller through `--fx-color`.
- The effect palette: eight hues (25, 55, 85, 120, 150, 265, 305, 345 — nothing between 180 and 230, so cyan stays the measurement colour) at one shared lightness and low chroma, each mixed toward `--tungsten`. Defined in `client/tokens.css`; its three knobs `--fx-light`, `--fx-chroma`, `--fx-tint` live in `anim:tunables`.
- One-shots ≤ ~600ms except celebrations (`fx-tada`, confetti); loops ≥ 1200ms per cycle.
- Every effect default lives inside the `/* anim:tunables */ … /* /anim:tunables */` block in `client/style.css`, one `--name: value;` per line, with the unit the gallery dial uses (`ms`, `em`, `deg`, `px`, or none). The harness Save only rewrites lines already present in that block.
- Uniform per-element overrides: `--fx-dur`, `--fx-amp`, `--fx-color`, plus `--fx-from` for `fx-slide`. Each rule resolves these into private `--_d`, `--_a`, `--_c`.
- The six existing anchors (`stamp`, `aftershock`, `bloom`, `strike`, `slam`, `flare`, `punch`, `land`, `cast`, `cast-flare`) are not modified.
- Client tests run under plain Node: no DOM, no `.tsx` imports.
- Server TS runs by type stripping: no enums, no parameter properties.

---

### Task 1: Pure helpers in `client/fx.ts`

**Files:**
- Create: `client/fx.ts`
- Test: `client/fx.test.ts`

**Interfaces:**
- Produces:
  - `graphemes(text: string): string[]`
  - `words(text: string): string[][]`
  - `type BurstKind = 'sparkle' | 'dust' | 'confetti' | 'embers' | 'stars' | 'emoji'`
  - `type Particle = { x: number; y: number; rot: number; delay: number; size: number; color: string; glyph: string }` — `x`,`y` are end offsets in units of the burst amount (−1…1, y positive is down), `rot` degrees, `delay` ms, `size` a scale, `color` a CSS value or `''`.
  - `BURST_COUNT: Record<BurstKind, number>`
  - `particles(kind: BurstKind, count: number, rand?: () => number, glyph?: string): Particle[]`
  - `countAt(from: number, to: number, k: number): number`

- [ ] **Step 1: Write the failing test**

Create `client/fx.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { BURST_COUNT, countAt, graphemes, particles, words, type BurstKind } from './fx.ts'

/** A deterministic stand-in for Math.random. */
function seeded(seed = 1) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}

const KINDS = Object.keys(BURST_COUNT) as BurstKind[]

test('graphemes keeps emoji and combining marks whole', () => {
  assert.deepEqual(graphemes('é👨‍👩‍👧!'), ['é', '👨‍👩‍👧', '!'])
})

test('words splits on runs of whitespace and drops the ends', () => {
  assert.deepEqual(words('  Ada  wins 🎉 '), [['A', 'd', 'a'], ['w', 'i', 'n', 's'], ['🎉']])
})

test('particles returns the requested count for every kind', () => {
  for (const kind of KINDS) assert.equal(particles(kind, 7, seeded()).length, 7, kind)
})

test('every particle ends within one amount of the centre', () => {
  for (const kind of KINDS)
    for (const p of particles(kind, 50, seeded(9)))
      assert.ok(Math.hypot(p.x, p.y) <= 1.0001, `${kind} flew to ${p.x},${p.y}`)
})

test('confetti is in the effect palette and flies upward', () => {
  for (const p of particles('confetti', 50, seeded(2))) {
    assert.match(p.color, /^var\(--fx-[1-8]\)$/)
    assert.ok(p.y < 0)
  }
})

test('embers rise and dust spreads sideways', () => {
  for (const p of particles('embers', 50, seeded(4))) assert.ok(p.y < 0)
  for (const p of particles('dust', 50, seeded(5))) assert.ok(Math.abs(p.y) < Math.abs(p.x))
})

test('emoji carries the glyph it was given', () => {
  for (const p of particles('emoji', 5, seeded(), '🦆')) assert.equal(p.glyph, '🦆')
})

test('the same seed gives the same burst', () => {
  assert.deepEqual(particles('stars', 5, seeded(3)), particles('stars', 5, seeded(3)))
})

test('countAt runs from `from` to `to` and never goes backwards', () => {
  assert.equal(countAt(0, 400, 0), 0)
  assert.equal(countAt(0, 400, 1), 400)
  assert.equal(countAt(0, 400, 2), 400)
  let last = -1
  for (let k = 0; k <= 1; k += 0.05) {
    const n = countAt(0, 400, k)
    assert.ok(n >= last)
    last = n
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test client/fx.test.ts`
Expected: FAIL — cannot find module `./fx.ts`.

- [ ] **Step 3: Write the implementation**

Create `client/fx.ts`:

```ts
/**
 * The interest kit's plain logic, kept apart from the components so Node can
 * test it. The components are in fx.tsx; the motion is the FX section of
 * style.css; the rules are docs/design.md §4 "Interest kit".
 */

const SEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Characters as a person counts them: an emoji or an accented letter is one. */
export function graphemes(text: string): string[] {
  return Array.from(SEG.segment(text), (s) => s.segment)
}

/** Words as grapheme lists, so a per-letter effect never breaks a word across lines. */
export function words(text: string): string[][] {
  return text.split(/\s+/).filter(Boolean).map(graphemes)
}

export type BurstKind = 'sparkle' | 'dust' | 'confetti' | 'embers' | 'stars' | 'emoji'

/** One particle's path. `x`/`y` are the end offset in units of the burst amount. */
export type Particle = {
  x: number
  y: number
  rot: number
  delay: number
  size: number
  color: string
  glyph: string
}

export const BURST_COUNT: Record<BurstKind, number> = {
  sparkle: 12,
  dust: 10,
  confetti: 24,
  embers: 14,
  stars: 10,
  emoji: 8,
}

const PALETTE = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `var(--fx-${n})`)
const WARM = ['var(--hot)', 'var(--tungsten)', 'var(--brass)']

export function particles(
  kind: BurstKind,
  count: number,
  rand: () => number = Math.random,
  glyph = '🎉',
): Particle[] {
  const r = (lo: number, hi: number) => lo + (hi - lo) * rand()
  const pick = (xs: string[]) => xs[Math.floor(rand() * xs.length)]
  // An angle in degrees (0 is right, 90 is down) and a distance, as an offset.
  const at = (deg: number, dist: number) => ({
    x: Math.cos((deg * Math.PI) / 180) * dist,
    y: Math.sin((deg * Math.PI) / 180) * dist,
  })

  return Array.from({ length: count }, (): Particle => {
    switch (kind) {
      case 'sparkle':
        return { ...at(r(0, 360), r(0.2, 0.6)), rot: 0, delay: r(0, 300), size: r(0.6, 1.2), color: pick(WARM), glyph: '✦' }
      case 'dust':
        return { ...at((rand() < 0.5 ? 180 : 0) + r(-25, 25), r(0.4, 0.8)), rot: 0, delay: r(0, 60), size: r(0.8, 1.6), color: 'var(--dim)', glyph: '' }
      case 'confetti':
        return { ...at(r(210, 330), r(0.6, 1)), rot: r(-720, 720), delay: r(0, 80), size: r(0.7, 1.1), color: pick(PALETTE), glyph: '' }
      case 'embers':
        return { x: r(-0.3, 0.3), y: r(-0.95, -0.6), rot: 0, delay: r(0, 400), size: r(0.4, 0.9), color: pick(['var(--tungsten)', 'var(--tally)']), glyph: '' }
      case 'stars':
        return { ...at(r(0, 360), r(0.7, 1)), rot: r(-180, 180), delay: r(0, 60), size: r(0.7, 1.2), color: pick(['var(--brass)', 'var(--hot)']), glyph: '★' }
      case 'emoji':
        return { ...at(r(200, 340), r(0.6, 1)), rot: r(-30, 30), delay: r(0, 80), size: r(0.8, 1.3), color: '', glyph }
    }
  })
}

/** What a count-up shows at progress `k` (0…1): ease-out, whole numbers. */
export function countAt(from: number, to: number, k: number): number {
  const t = Math.min(1, Math.max(0, k))
  return Math.round(from + (to - from) * (1 - (1 - t) ** 3))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test client/fx.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` — expected: no errors.

```bash
git add client/fx.ts client/fx.test.ts
git commit -m "feat: add the interest kit's pure helpers"
```

---

### Task 2: Tunables guard, and the entrance, loop, and hit classes

**Files:**
- Modify: `client/tunables.test.ts` (append one test)
- Modify: `client/tokens.css` — the effect palette
- Modify: `client/style.css` — the `anim:tunables` block (after `--penalty-dwell: 2200ms;`), and a new `FX` section inserted after the closing brace of `@keyframes cast-flare` and before `@media (max-width: 40rem)`

**Interfaces:**
- Produces: palette tokens `--fx-1`…`--fx-8` and knobs `--fx-light`, `--fx-chroma`, `--fx-tint`; classes `fx-fade` (`fx-fade--out`), `fx-pop`, `fx-drop`, `fx-rise`, `fx-slide`, `fx-flip`, `fx-zoom`, `fx-shrink`, `fx-poof`, `fx-bob`, `fx-float`, `fx-breathe`, `fx-heartbeat`, `fx-sway`, `fx-wiggle`, `fx-glow-pulse`, `fx-spin`, `fx-shake`, `fx-squash`, `fx-flash`, `fx-ripple`, `fx-nudge`, `fx-wobble`, `fx-tada`; defaults `--fx-<name>-dur` / `--fx-<name>-amp`.

- [ ] **Step 1: Write the guard test**

Append to `client/tunables.test.ts`:

```ts
test('every --fx-* default the kit or its gallery reads is declared in the block', () => {
  const gallery = readFileSync(new URL('./anim/scenarios.tsx', import.meta.url), 'utf8')
  // The per-element overrides are set by callers, never declared as defaults.
  const OVERRIDES = new Set(['--fx-dur', '--fx-amp', '--fx-color', '--fx-from'])
  const used = new Set([...(css + gallery).matchAll(/--fx-[a-z-]+/g)].map((m) => m[0]))
  for (const name of used) {
    if (OVERRIDES.has(name)) continue
    assert.match(block, new RegExp(`^\\s*${name}:`, 'm'), `${name} is not declared in anim:tunables`)
  }
})
```

- [ ] **Step 2: Run it**

Run: `node --test client/tunables.test.ts`
Expected: PASS (nothing uses `--fx-*` yet). It starts guarding once Step 4 lands.

- [ ] **Step 3: Add the defaults to `anim:tunables`**

In `client/style.css`, directly after the `--penalty-dwell: 2200ms;` line inside the tunables block, insert:

```css

  /* Interest kit — each effect's defaults (FX section below; design.md §4).
     Tune one element with --fx-dur / --fx-amp / --fx-color instead. */
  /* The effect palette's shared knobs (the hues are in tokens.css): one
     lightness and one low chroma keep it matte, and the tint pulls every hue
     toward tungsten so it sits under the same lamp as the set. */
  --fx-light: 0.76;
  --fx-chroma: 0.09;
  --fx-tint: 18%;
  --fx-fade-dur: 240ms;
  --fx-pop-dur: 320ms;
  --fx-pop-amp: 1.15;
  --fx-drop-dur: 420ms;
  --fx-drop-amp: 1.2em;
  --fx-rise-dur: 360ms;
  --fx-rise-amp: 0.6em;
  --fx-slide-dur: 300ms;
  --fx-slide-amp: 2em;
  --fx-flip-dur: 420ms;
  --fx-zoom-dur: 320ms;
  --fx-zoom-amp: 1.6;
  --fx-shrink-dur: 220ms;
  --fx-poof-dur: 200ms;
  --fx-bob-dur: 1600ms;
  --fx-bob-amp: 0.15em;
  --fx-float-dur: 4000ms;
  --fx-float-amp: 0.2em;
  --fx-breathe-dur: 2400ms;
  --fx-breathe-amp: 1.04;
  --fx-heartbeat-dur: 1400ms;
  --fx-heartbeat-amp: 1.1;
  --fx-sway-dur: 2400ms;
  --fx-sway-amp: 4deg;
  --fx-wiggle-dur: 1600ms;
  --fx-wiggle-amp: 6deg;
  --fx-glow-pulse-dur: 2000ms;
  --fx-glow-pulse-amp: 12px;
  --fx-spin-dur: 8000ms;
  --fx-shake-dur: 420ms;
  --fx-shake-amp: 0.3em;
  --fx-squash-dur: 360ms;
  --fx-squash-amp: 0.25;
  --fx-flash-dur: 300ms;
  --fx-ripple-dur: 600ms;
  --fx-ripple-amp: 1.8;
  --fx-nudge-dur: 200ms;
  --fx-nudge-amp: 0.2em;
  --fx-wobble-dur: 600ms;
  --fx-wobble-amp: 12deg;
  --fx-tada-dur: 800ms;
  --fx-tada-amp: 1.12;
```

- [ ] **Step 3b: Add the effect palette to `client/tokens.css`**

Directly after `--id-6: #8ed081;` (before the `/* --- Type` comment), add:

```css

  /* Effect palette — for multicolour effects (rainbow, confetti, glitch), so
     they never read as belonging to a player. Eight hues around the wheel,
     skipping 180–230 so cyan stays the measurement colour. Lightness, chroma
     and the warm tint are shared knobs in anim:tunables (style.css). */
  --fx-1: color-mix(in oklab, oklch(var(--fx-light) var(--fx-chroma) 25), var(--tungsten) var(--fx-tint));
  --fx-2: color-mix(in oklab, oklch(var(--fx-light) var(--fx-chroma) 55), var(--tungsten) var(--fx-tint));
  --fx-3: color-mix(in oklab, oklch(var(--fx-light) var(--fx-chroma) 85), var(--tungsten) var(--fx-tint));
  --fx-4: color-mix(in oklab, oklch(var(--fx-light) var(--fx-chroma) 120), var(--tungsten) var(--fx-tint));
  --fx-5: color-mix(in oklab, oklch(var(--fx-light) var(--fx-chroma) 150), var(--tungsten) var(--fx-tint));
  --fx-6: color-mix(in oklab, oklch(var(--fx-light) var(--fx-chroma) 265), var(--tungsten) var(--fx-tint));
  --fx-7: color-mix(in oklab, oklch(var(--fx-light) var(--fx-chroma) 305), var(--tungsten) var(--fx-tint));
  --fx-8: color-mix(in oklab, oklch(var(--fx-light) var(--fx-chroma) 345), var(--tungsten) var(--fx-tint));
```

- [ ] **Step 4: Add the FX section**

In `client/style.css`, after the closing `}` of `@keyframes cast-flare` and before `@media (max-width: 40rem)`, insert:

```css

/* ===================================================================
 * FX — the interest kit
 *
 * Effects any element can wear: entrances, exits, idle loops, hits, text
 * effects and particles. The rules for using them, and a table of every class
 * and what its amount means, are in docs/design.md §4 "Interest kit". Each one
 * has a scenario in the motion harness (`npm run motion`).
 *
 * Every rule resolves `--_d` (duration), `--_a` (amount) and `--_c` (colour)
 * from the caller's `--fx-dur` / `--fx-amp` / `--fx-color`, falling back to the
 * effect's default in anim:tunables. One effect per element: each owns
 * `animation` and `transform`, so nest a wrapper to combine two.
 *
 * ponytail: the `--fx-*` overrides inherit, so one set on an element also
 * reaches any effect nested inside it. Registering them with
 * `@property … { syntax: '*'; inherits: false }` is the fix if that bites.
 * =================================================================== */

/* --- Entrances and exits (once) --------------------------------------
   An exit leaves the element invisible but in place; unmount it on
   `animationend`. */
.fx-fade { --_d: var(--fx-dur, var(--fx-fade-dur)); animation: fx-fade var(--_d) var(--ease) both; }
.fx-fade--out { animation-direction: reverse; }
@keyframes fx-fade { from { opacity: 0; } }

.fx-pop {
  --_d: var(--fx-dur, var(--fx-pop-dur));
  --_a: var(--fx-amp, var(--fx-pop-amp));
  animation: fx-pop var(--_d) var(--ease) both;
}
@keyframes fx-pop {
  from { opacity: 0; transform: scale(0.4); }
  60% { opacity: 1; transform: scale(var(--_a)); }
  to { opacity: 1; transform: none; }
}

/* Squashes on the floor it lands on, so the origin is the bottom edge. */
.fx-drop {
  --_d: var(--fx-dur, var(--fx-drop-dur));
  --_a: var(--fx-amp, var(--fx-drop-amp));
  transform-origin: 50% 100%;
  animation: fx-drop var(--_d) linear both;
}
@keyframes fx-drop {
  from { opacity: 0; transform: translateY(calc(var(--_a) * -1)); animation-timing-function: cubic-bezier(0.5, 0, 1, 1); }
  55% { opacity: 1; transform: scale(1.1, 0.88); animation-timing-function: cubic-bezier(0.2, 0.8, 0.3, 1); }
  80% { transform: scale(0.97, 1.04); }
  to { opacity: 1; transform: none; }
}

.fx-rise {
  --_d: var(--fx-dur, var(--fx-rise-dur));
  --_a: var(--fx-amp, var(--fx-rise-amp));
  animation: fx-rise var(--_d) var(--ease) both;
}
@keyframes fx-rise { from { opacity: 0; transform: translateY(var(--_a)); } }

/* `--fx-from`: -1 slides in from the left, 1 from the right. */
.fx-slide {
  --_d: var(--fx-dur, var(--fx-slide-dur));
  --_a: var(--fx-amp, var(--fx-slide-amp));
  animation: fx-slide var(--_d) var(--ease) both;
}
@keyframes fx-slide { from { opacity: 0; transform: translateX(calc(var(--fx-from, -1) * var(--_a))); } }

.fx-flip { --_d: var(--fx-dur, var(--fx-flip-dur)); animation: fx-flip var(--_d) var(--ease) both; }
@keyframes fx-flip {
  from { opacity: 0; transform: perspective(40em) rotateY(-90deg); }
  to { opacity: 1; transform: perspective(40em) rotateY(0); }
}

.fx-zoom {
  --_d: var(--fx-dur, var(--fx-zoom-dur));
  --_a: var(--fx-amp, var(--fx-zoom-amp));
  animation: fx-zoom var(--_d) var(--ease) both;
}
@keyframes fx-zoom { from { opacity: 0; transform: scale(var(--_a)); filter: blur(0.3em); } }

.fx-shrink { --_d: var(--fx-dur, var(--fx-shrink-dur)); animation: fx-shrink var(--_d) var(--ease) forwards; }
@keyframes fx-shrink { to { opacity: 0; transform: scale(0.3); } }

/* Pair with <Burst kind="dust"> in a positioned parent. */
.fx-poof { --_d: var(--fx-dur, var(--fx-poof-dur)); animation: fx-poof var(--_d) cubic-bezier(0.5, 0, 1, 1) forwards; }
@keyframes fx-poof { to { opacity: 0; transform: scale(0.2); filter: blur(0.2em); } }

/* --- Idle loops ------------------------------------------------------
   Keyframes name only the moves; the rest pose is the element's own. */
.fx-bob {
  --_d: var(--fx-dur, var(--fx-bob-dur));
  --_a: var(--fx-amp, var(--fx-bob-amp));
  animation: fx-bob var(--_d) ease-in-out infinite;
}
@keyframes fx-bob { 50% { transform: translateY(calc(var(--_a) * -1)); } }

.fx-float {
  --_d: var(--fx-dur, var(--fx-float-dur));
  --_a: var(--fx-amp, var(--fx-float-amp));
  animation: fx-float var(--_d) ease-in-out infinite;
}
@keyframes fx-float {
  33% { transform: translate(var(--_a), calc(var(--_a) * -1)); }
  66% { transform: translate(calc(var(--_a) * -1), calc(var(--_a) * -0.5)); }
}

.fx-breathe {
  --_d: var(--fx-dur, var(--fx-breathe-dur));
  --_a: var(--fx-amp, var(--fx-breathe-amp));
  animation: fx-breathe var(--_d) ease-in-out infinite;
}
@keyframes fx-breathe { 50% { transform: scale(var(--_a)); } }

.fx-heartbeat {
  --_d: var(--fx-dur, var(--fx-heartbeat-dur));
  --_a: var(--fx-amp, var(--fx-heartbeat-amp));
  animation: fx-heartbeat var(--_d) ease-in-out infinite;
}
@keyframes fx-heartbeat {
  14%, 42% { transform: scale(var(--_a)); }
  28%, 70% { transform: none; }
}

.fx-sway {
  --_d: var(--fx-dur, var(--fx-sway-dur));
  --_a: var(--fx-amp, var(--fx-sway-amp));
  animation: fx-sway var(--_d) ease-in-out infinite;
}
@keyframes fx-sway {
  25% { transform: rotate(var(--_a)); }
  75% { transform: rotate(calc(var(--_a) * -1)); }
}

.fx-wiggle {
  --_d: var(--fx-dur, var(--fx-wiggle-dur));
  --_a: var(--fx-amp, var(--fx-wiggle-amp));
  animation: fx-wiggle var(--_d) linear infinite;
}
@keyframes fx-wiggle {
  60%, 85% { transform: none; }
  65%, 75% { transform: rotate(var(--_a)); }
  70%, 80% { transform: rotate(calc(var(--_a) * -1)); }
}

.fx-glow-pulse {
  --_d: var(--fx-dur, var(--fx-glow-pulse-dur));
  --_a: var(--fx-amp, var(--fx-glow-pulse-amp));
  --_c: var(--fx-color, var(--tungsten));
  animation: fx-glow-pulse var(--_d) ease-in-out infinite;
}
@keyframes fx-glow-pulse { 50% { filter: drop-shadow(0 0 var(--_a) var(--_c)); } }

.fx-spin { --_d: var(--fx-dur, var(--fx-spin-dur)); animation: fx-spin var(--_d) linear infinite; }
@keyframes fx-spin { to { transform: rotate(1turn); } }

/* --- Hits (once, on an event) ----------------------------------------
   A hit replays when its class is removed and re-added, or when the element
   remounts with a new key. */
.fx-shake {
  --_d: var(--fx-dur, var(--fx-shake-dur));
  --_a: var(--fx-amp, var(--fx-shake-amp));
  animation: fx-shake var(--_d) ease-in-out;
}
@keyframes fx-shake {
  15%, 45% { transform: translateX(calc(var(--_a) * -1)); }
  30%, 60% { transform: translateX(var(--_a)); }
  75% { transform: translateX(calc(var(--_a) * -0.4)); }
}

.fx-squash {
  --_d: var(--fx-dur, var(--fx-squash-dur));
  --_a: var(--fx-amp, var(--fx-squash-amp));
  transform-origin: 50% 100%;
  animation: fx-squash var(--_d) var(--ease);
}
@keyframes fx-squash {
  30% { transform: scale(calc(1 + var(--_a)), calc(1 - var(--_a))); }
  60% { transform: scale(calc(1 - var(--_a) / 2), calc(1 + var(--_a) / 2)); }
}

.fx-flash { --_d: var(--fx-dur, var(--fx-flash-dur)); animation: fx-flash var(--_d) var(--ease); }
@keyframes fx-flash { from { filter: brightness(2.5); } }

/* Draws on ::after, so it leaves the element's own transform alone and can
   sit beside another effect. It positions the element to anchor the ring. */
.fx-ripple {
  --_d: var(--fx-dur, var(--fx-ripple-dur));
  --_a: var(--fx-amp, var(--fx-ripple-amp));
  --_c: var(--fx-color, var(--tungsten));
  position: relative;
}
.fx-ripple::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: 0 0 0 2px var(--_c);
  pointer-events: none;
  animation: fx-ripple var(--_d) var(--ease) forwards;
}
@keyframes fx-ripple { to { opacity: 0; transform: scale(var(--_a)); } }

.fx-nudge {
  --_d: var(--fx-dur, var(--fx-nudge-dur));
  --_a: var(--fx-amp, var(--fx-nudge-amp));
  animation: fx-nudge var(--_d) var(--ease);
}
@keyframes fx-nudge { 40% { transform: translateY(var(--_a)) scale(0.97); } }

.fx-wobble {
  --_d: var(--fx-dur, var(--fx-wobble-dur));
  --_a: var(--fx-amp, var(--fx-wobble-amp));
  animation: fx-wobble var(--_d) ease-in-out;
}
@keyframes fx-wobble {
  15% { transform: skewX(calc(var(--_a) * -1)); }
  30% { transform: skewX(calc(var(--_a) * 0.7)); }
  45% { transform: skewX(calc(var(--_a) * -0.4)); }
  60% { transform: skewX(calc(var(--_a) * 0.2)); }
  75% { transform: none; }
}

.fx-tada {
  --_d: var(--fx-dur, var(--fx-tada-dur));
  --_a: var(--fx-amp, var(--fx-tada-amp));
  animation: fx-tada var(--_d) ease-in-out;
}
@keyframes fx-tada {
  10%, 20% { transform: scale(0.92) rotate(-3deg); }
  30%, 50%, 70%, 90% { transform: scale(var(--_a)) rotate(3deg); }
  40%, 60%, 80% { transform: scale(var(--_a)) rotate(-3deg); }
}
```

- [ ] **Step 5: Run the guard, and prove it guards**

Run: `node --test client/tunables.test.ts` — expected: PASS.
Temporarily delete the `--fx-tada-amp: 1.12;` line, rerun — expected: FAIL naming `--fx-tada-amp`. Restore it and rerun — PASS.

- [ ] **Step 6: Build and commit**

Run: `npm run build` — expected: succeeds with no CSS warnings about the new section.

```bash
git add client/style.css client/tunables.test.ts
git commit -m "feat: add the interest kit's entrance, loop, and hit effects"
```

---

### Task 3: Text effects, `<Letters>`, and `<CountUp>`

**Files:**
- Modify: `client/style.css` — tunables block (after `--fx-tada-amp`), FX section (append after `@keyframes fx-tada`)
- Create: `client/fx.tsx`

**Interfaces:**
- Consumes: `words`, `countAt` from `client/fx.ts` (Task 1).
- Consumes: `--fx-1`…`--fx-8` (Task 2).
- Produces:
  - `Letters(props: { text: string; class?: string }): JSX.Element` — renders `.fx-letters` › visually hidden `.fx-sr` copy + `aria-hidden` span of `.fx-word` spans, each holding letter spans with `style="--i:n"` (n counts letters across the whole text).
  - `CountUp(props: { to: number; from?: number; ms?: number }): JSX.Element` — `<span class="fx-count">`.
  - `reduced(): boolean` (module-private helper, reused by Task 4 in the same file).
  - Classes `fx-wave`, `fx-rainbow`, `fx-cascade`, `fx-jitter`, `fx-type` (per-letter, on `<Letters class>`), `fx-shine`, `fx-glitch` (needs `data-text`), `fx-neon` (whole element).

- [ ] **Step 1: Add the text defaults to `anim:tunables`**

After `--fx-tada-amp: 1.12;` insert:

```css
  --fx-stagger: 60ms;
  --fx-wave-dur: 1400ms;
  --fx-wave-amp: 0.2em;
  --fx-rainbow-dur: 3000ms;
  --fx-cascade-dur: 260ms;
  --fx-jitter-dur: 1200ms;
  --fx-jitter-amp: 0.06em;
  --fx-type-dur: 45ms;
  --fx-shine-dur: 1800ms;
  --fx-glitch-dur: 1400ms;
  --fx-glitch-amp: 0.06em;
  --fx-neon-dur: 900ms;
```

- [ ] **Step 2: Add the text rules to the FX section**

Append after `@keyframes fx-tada { … }`:

```css

/* --- Text -------------------------------------------------------------
   Per-letter effects go on <Letters class="…"> from fx.tsx, which gives each
   letter `--i`. The rest go on any element holding text. */
.fx-letters .fx-word { display: inline-block; white-space: nowrap; }
.fx-letters .fx-word > span { display: inline-block; }
.fx-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.fx-wave { --_d: var(--fx-dur, var(--fx-wave-dur)); --_a: var(--fx-amp, var(--fx-wave-amp)); }
.fx-wave .fx-word > span {
  animation: fx-wave var(--_d) ease-in-out calc(var(--i) * var(--fx-stagger)) infinite;
}
@keyframes fx-wave {
  20% { transform: translateY(calc(var(--_a) * -1)); }
  40% { transform: none; }
}

/* Negative delays, so every letter is already coloured on the first frame. */
.fx-rainbow { --_d: var(--fx-dur, var(--fx-rainbow-dur)); }
.fx-rainbow .fx-word > span {
  animation: fx-rainbow var(--_d) linear calc(var(--i) * var(--fx-stagger) * -2) infinite;
}
@keyframes fx-rainbow {
  0%, 100% { color: var(--fx-1); }
  12.5% { color: var(--fx-2); }
  25% { color: var(--fx-3); }
  37.5% { color: var(--fx-4); }
  50% { color: var(--fx-5); }
  62.5% { color: var(--fx-6); }
  75% { color: var(--fx-7); }
  87.5% { color: var(--fx-8); }
}

.fx-cascade { --_d: var(--fx-dur, var(--fx-cascade-dur)); }
.fx-cascade .fx-word > span {
  animation: fx-cascade var(--_d) var(--slam) calc(var(--i) * var(--fx-stagger)) backwards;
}
@keyframes fx-cascade { from { opacity: 0; transform: translateY(0.4em) scale(0.6); } }

/* A prime-ish offset per letter, so neighbours never twitch together. */
.fx-jitter { --_d: var(--fx-dur, var(--fx-jitter-dur)); --_a: var(--fx-amp, var(--fx-jitter-amp)); }
.fx-jitter .fx-word > span {
  animation: fx-jitter var(--_d) steps(1) calc(var(--i) * -137ms) infinite;
}
@keyframes fx-jitter {
  0% { transform: translate(var(--_a), calc(var(--_a) * -1)); }
  25% { transform: translate(calc(var(--_a) * -1), var(--_a)); }
  50% { transform: translate(var(--_a), var(--_a)); }
  75% { transform: translate(calc(var(--_a) * -1), calc(var(--_a) * -1)); }
}

/* `--fx-dur` here is the time per letter. */
.fx-type { --_d: var(--fx-dur, var(--fx-type-dur)); }
.fx-type .fx-word > span {
  animation: fx-type 1ms steps(1) calc(var(--i) * var(--_d)) backwards;
}
@keyframes fx-type { from { opacity: 0; } to { opacity: 0; } }

/* The fill goes transparent but `color` stays, so the band sweeps across the
   element's own colour. Not for emoji: a bitmap glyph has no fill to clip. */
.fx-shine {
  --_d: var(--fx-dur, var(--fx-shine-dur));
  --_c: var(--fx-color, var(--hot));
  background: linear-gradient(100deg, currentColor 40%, var(--_c) 50%, currentColor 60%) 100% 0 / 250% 100% no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: fx-shine var(--_d) ease-in-out infinite;
}
@keyframes fx-shine { 60%, 100% { background-position: 0 0; } }

/* Needs `data-text` holding the same text: the split copies are drawn from it. */
.fx-glitch {
  --_d: var(--fx-dur, var(--fx-glitch-dur));
  --_a: var(--fx-amp, var(--fx-glitch-amp));
  position: relative;
}
.fx-glitch::before,
.fx-glitch::after {
  content: attr(data-text);
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  animation: fx-glitch var(--_d) steps(1) infinite;
}
.fx-glitch::before { --_s: -1; color: var(--fx-1); }
.fx-glitch::after { --_s: 1; color: var(--fx-6); animation-delay: 60ms; }
@keyframes fx-glitch {
  88% { opacity: 0.85; transform: translateX(calc(var(--_a) * var(--_s))); clip-path: inset(10% 0 55% 0); }
  92% { opacity: 0.85; transform: translateX(calc(var(--_a) * var(--_s) * -1)); clip-path: inset(50% 0 15% 0); }
  96% { opacity: 0; }
}

/* Flickers on once, then holds the glow. */
.fx-neon {
  --_d: var(--fx-dur, var(--fx-neon-dur));
  --_c: var(--fx-color, var(--tungsten));
  animation: fx-neon var(--_d) linear both;
}
@keyframes fx-neon {
  0% { opacity: 0.15; }
  10%, 20%, 40% { opacity: 1; }
  12%, 22% { opacity: 0.25; }
  42% { opacity: 0.6; }
  60%, 100% { opacity: 1; text-shadow: 0 0 0.08em var(--_c), 0 0 0.35em var(--_c); }
}

.fx-count { font-variant-numeric: tabular-nums; }
```

- [ ] **Step 3: Create `client/fx.tsx` with `Letters` and `CountUp`**

```tsx
/**
 * The interest kit's components: the effects that need markup or a clock.
 * Everything else is a class in the FX section of style.css. Rules and the
 * full catalogue: docs/design.md §4 "Interest kit".
 */
import { Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { countAt, words } from './fx.ts'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Text split into letters for the per-letter classes (`fx-wave`, `fx-rainbow`,
 * `fx-cascade`, `fx-jitter`, `fx-type`). Each word stays one unbreakable span;
 * a screen reader reads the hidden copy once instead of letter by letter.
 */
export function Letters({ text, class: cls = '' }: { text: string; class?: string }) {
  let i = 0
  return (
    <span class={`fx-letters ${cls}`}>
      <span class="fx-sr">{text}</span>
      <span aria-hidden="true">
        {words(text).map((word, w) => (
          <Fragment key={w}>
            {w > 0 && ' '}
            <span class="fx-word">
              {word.map((g) => (
                <span style={`--i:${i++}`}>{g}</span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  )
}

/** A number rolling up to its value. Under reduced motion it shows `to` at once. */
export function CountUp({ to, from = 0, ms = 600 }: { to: number; from?: number; ms?: number }) {
  const [n, setN] = useState(() => (reduced() ? to : from))
  useEffect(() => {
    if (reduced()) {
      setN(to)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = (t - t0) / ms
      setN(countAt(from, to, k))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, from, ms])
  return <span class="fx-count">{n}</span>
}
```

- [ ] **Step 4: Verify**

Run: `node --test client/tunables.test.ts client/fx.test.ts` — expected: PASS.
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/style.css client/fx.tsx
git commit -m "feat: add the interest kit's text effects, Letters, and CountUp"
```

---

### Task 4: Particles and `<Burst>`

**Files:**
- Modify: `client/style.css` — tunables block (after `--fx-neon-dur`), FX section (append after `.fx-count`)
- Modify: `client/fx.tsx` (add `Burst`)

**Interfaces:**
- Consumes: `particles`, `BURST_COUNT`, `BurstKind` from `client/fx.ts`; `reduced` in `client/fx.tsx`.
- Produces:
  - `Burst(props: { kind: BurstKind; glyph?: string; count?: number }): JSX.Element | null` — `<span class="fx-burst fx-burst--{kind}" aria-hidden="true">` of `<i>` particles; removes itself after the last particle's `animationend`.
  - Class `fx-anchor` (`position: relative`) for a Burst's parent.

- [ ] **Step 1: Add the particle defaults**

After `--fx-neon-dur: 900ms;` insert:

```css
  --fx-burst-dur: 800ms;
  --fx-burst-amp: 4em;
```

- [ ] **Step 2: Add the particle rules**

Append after `.fx-count { … }`:

```css

/* --- Particles: <Burst> from fx.tsx ----------------------------------
   The layer fills its nearest positioned ancestor (`fx-anchor` makes one)
   and bursts from its centre. Each particle carries --x/--y (end offset, as a
   fraction of the amount), --rot, --delay and --size from `particles()` in
   fx.ts. Confetti and embers run longer than the base duration: confetti is a
   celebration, and embers read as embers only while drifting. */
.fx-anchor { position: relative; }
.fx-burst {
  --_d: var(--fx-dur, var(--fx-burst-dur));
  --_a: var(--fx-amp, var(--fx-burst-amp));
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.fx-burst > i {
  position: absolute;
  left: 50%;
  top: 50%;
  translate: -50% -50%;
  font-style: normal;
  line-height: 1;
  animation: fx-fling var(--_d) var(--ease) var(--delay) both;
}
.fx-burst--sparkle > i { animation-name: fx-twinkle; }
.fx-burst--dust > i {
  width: 0.6em;
  height: 0.6em;
  border-radius: 50%;
  background: currentColor;
  filter: blur(0.12em);
  animation-name: fx-dust;
}
.fx-burst--confetti > i {
  width: 0.35em;
  height: 0.6em;
  background: currentColor;
  animation: fx-confetti calc(var(--_d) * 2) linear var(--delay) both;
}
.fx-burst--embers > i {
  width: 0.25em;
  height: 0.25em;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0.3em currentColor;
  animation: fx-ember calc(var(--_d) * 1.5) ease-out var(--delay) both;
}

/* Stars and emoji: out from the centre, spinning, fading. */
@keyframes fx-fling {
  from { opacity: 1; transform: scale(0); }
  25% { opacity: 1; transform: translate(calc(var(--x) * var(--_a) * 0.4), calc(var(--y) * var(--_a) * 0.4)) scale(var(--size)); }
  to { opacity: 0; transform: translate(calc(var(--x) * var(--_a)), calc(var(--y) * var(--_a))) rotate(var(--rot)) scale(calc(var(--size) * 0.6)); }
}
/* In place: each sparkle appears where it is, turns, and goes out. */
@keyframes fx-twinkle {
  from { opacity: 0; transform: translate(calc(var(--x) * var(--_a)), calc(var(--y) * var(--_a))) scale(0); }
  50% { opacity: 1; transform: translate(calc(var(--x) * var(--_a)), calc(var(--y) * var(--_a))) scale(var(--size)) rotate(45deg); }
  to { opacity: 0; transform: translate(calc(var(--x) * var(--_a)), calc(var(--y) * var(--_a))) scale(0) rotate(90deg); }
}
@keyframes fx-dust {
  from { opacity: 0.7; transform: scale(calc(var(--size) * 0.4)); }
  to { opacity: 0; transform: translate(calc(var(--x) * var(--_a)), calc(var(--y) * var(--_a))) scale(calc(var(--size) * 1.8)); }
}
/* Thrown up and out, then falling past where it started. */
@keyframes fx-confetti {
  from { opacity: 1; transform: scale(var(--size)); animation-timing-function: cubic-bezier(0.2, 0.8, 0.3, 1); }
  40% { opacity: 1; transform: translate(calc(var(--x) * var(--_a)), calc(var(--y) * var(--_a))) rotate(calc(var(--rot) * 0.4)) scale(var(--size)); animation-timing-function: cubic-bezier(0.5, 0, 1, 1); }
  to { opacity: 0; transform: translate(calc(var(--x) * var(--_a) * 1.3), calc(var(--y) * var(--_a) + var(--_a))) rotate(var(--rot)) scale(var(--size)); }
}
@keyframes fx-ember {
  from { opacity: 1; transform: scale(var(--size)); }
  to { opacity: 0; transform: translate(calc(var(--x) * var(--_a)), calc(var(--y) * var(--_a))) scale(calc(var(--size) * 0.2)); }
}
```

- [ ] **Step 3: Add `Burst` to `client/fx.tsx`**

Change the imports to:

```tsx
import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { BURST_COUNT, countAt, particles, words, type BurstKind } from './fx.ts'
```

Append:

```tsx
/**
 * A one-off spray of particles from the centre of the nearest positioned
 * ancestor (give it `fx-anchor`). It removes itself when the last particle
 * lands; mount a new one (a new `key`) to fire again. Renders nothing under
 * reduced motion.
 */
export function Burst({ kind, glyph, count }: { kind: BurstKind; glyph?: string; count?: number }) {
  const [bits] = useState(() => particles(kind, count ?? BURST_COUNT[kind], Math.random, glyph))
  const left = useRef(bits.length)
  const [done, setDone] = useState(false)
  if (done || reduced()) return null
  return (
    <span
      class={`fx-burst fx-burst--${kind}`}
      aria-hidden="true"
      onAnimationEnd={() => {
        if (--left.current === 0) setDone(true)
      }}
    >
      {bits.map((p, i) => (
        <i
          key={i}
          style={
            `--x:${p.x};--y:${p.y};--rot:${p.rot}deg;--delay:${p.delay}ms;--size:${p.size}` +
            (p.color ? `;color:${p.color}` : '')
          }
        >
          {p.glyph}
        </i>
      ))}
    </span>
  )
}
```

- [ ] **Step 4: Verify**

Run: `node --test client/tunables.test.ts client/fx.test.ts` — expected: PASS.
Run: `npm run typecheck` — expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/style.css client/fx.tsx
git commit -m "feat: add the interest kit's particle bursts"
```

---

### Task 5: The gallery in the motion harness

**Files:**
- Modify: `client/anim/scenarios.tsx` — `Scenario` type (add `family`), imports, and append FX scenarios to `SCENARIOS`
- Modify: `client/anim/main.tsx` — scenario list renders a family heading
- Modify: `client/anim/harness.css` — demo element styles

**Interfaces:**
- Consumes: `Letters`, `Burst`, `CountUp` from `client/fx.tsx`; `Dial`, `Scenario` from `scenarios.tsx`.
- Produces: a `fx-palette` scenario (family `Palette`) and one scenario per effect with id `fx-<name>` and `family` one of `Entrances`, `Loops`, `Hits`, `Text`, `Particles`.

- [ ] **Step 1: Add `family` to `Scenario`**

In `client/anim/scenarios.tsx`, inside `export type Scenario = {`, after `label: string`, add:

```ts
  /** Heading the harness list groups this under. The anchors have none. */
  family?: string
```

- [ ] **Step 2: Add the FX scenarios**

At the top of `client/anim/scenarios.tsx`, add to the imports:

```tsx
import { Burst, CountUp, Letters } from '../fx.tsx'
```

Directly above `export const SCENARIOS: Scenario[] = [`, add:

```tsx
/*
 * The interest kit, one scenario per effect.
 *
 * Dial names are written out in full on purpose: tunables.test.ts scans this
 * file for `--fx-*` names to check each one is declared in anim:tunables, and a
 * name built from a template would slip past it.
 */
const ms = (v: string, max: number, label = 'Duration'): Dial => ({ var: v, label, min: 0, max, step: 5, unit: 'ms' })
const amount = (v: string, min: number, max: number, step: number, unit: string, label = 'Amount'): Dial => ({
  var: v,
  label,
  min,
  max,
  step,
  unit,
})
const STAGGER: Dial = { var: '--fx-stagger', label: 'Stagger', min: 0, max: 200, step: 5, unit: 'ms' }
const BURST_DIALS = [ms('--fx-burst-dur', 3000), amount('--fx-burst-amp', 0, 12, 0.1, 'em')]

type El = (cls: string) => preact.JSX.Element
const word = (text = 'Ada'): El => (cls) => <p class={`fx-demo ${cls}`}>{text}</p>
const glitchWord: El = (cls) => <p class={`fx-demo ${cls}`} data-text="Ada">Ada</p>
const letters = (text: string): El => (cls) => (
  <p class="fx-demo">
    <Letters text={text} class={cls} />
  </p>
)
const tile: El = (cls) => <div class={`fx-tile ${cls}`} />
const chip: El = (cls) => <span class={`chip chip--won ${cls}`}>Winner</span>

/**
 * `enter`: the lead frame holds the element's space, hidden, and the take
 * mounts it with the class. `class`: the element is there all along and the
 * take adds the class, which is how a loop or a hit starts in the game.
 */
function fx(
  family: string,
  name: string,
  label: string,
  note: string,
  dials: Dial[],
  show: 'enter' | 'class',
  el: El,
): Scenario {
  return {
    id: `fx-${name}`,
    label,
    family,
    note,
    subject: `.fx-${name}`,
    dials,
    render: (lead) => (
      <div class="fx-stage">
        {!lead ? el(`fx-${name}`) : show === 'enter' ? <div style="visibility:hidden">{el('')}</div> : el('')}
      </div>
    ),
  }
}

function burst(kind: 'sparkle' | 'dust' | 'confetti' | 'embers' | 'stars' | 'emoji', label: string, note: string): Scenario {
  return {
    id: `fx-burst-${kind}`,
    label,
    family: 'Particles',
    note,
    subject: '.fx-burst',
    dials: BURST_DIALS,
    render: (lead) => (
      <div class="fx-stage">
        <div class="fx-anchor">
          <p class="fx-demo">Ada</p>
          {!lead && <Burst kind={kind} glyph="🦆" />}
        </div>
      </div>
    ),
  }
}

const FX: Scenario[] = [
  {
    id: 'fx-palette',
    label: 'Palette',
    family: 'Palette',
    note: 'The effect palette, --fx-1 to --fx-8. Matte, warm-tinted, no cyan. Three knobs move all eight.',
    subject: '.fx-swatches',
    dials: [
      amount('--fx-light', 0.4, 0.95, 0.01, '', 'Lightness'),
      amount('--fx-chroma', 0, 0.25, 0.005, '', 'Chroma'),
      amount('--fx-tint', 0, 60, 1, '%', 'Tungsten tint'),
    ],
    render: () => (
      <div class="fx-stage">
        <div class="fx-swatches">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div class="fx-swatch" style={`background:var(--fx-${n})`}>
              {n}
            </div>
          ))}
        </div>
      </div>
    ),
  },
  fx('Entrances', 'fade', 'Fade', 'fx-fade — the quietest arrival.', [ms('--fx-fade-dur', 1000)], 'enter', word()),
  fx('Entrances', 'pop', 'Pop', 'fx-pop — scales past full size and settles. Amount is the overshoot.', [ms('--fx-pop-dur', 1000), amount('--fx-pop-amp', 1, 1.6, 0.01, '')], 'enter', word()),
  fx('Entrances', 'drop', 'Drop', 'fx-drop — falls in and squashes on landing. Amount is the fall.', [ms('--fx-drop-dur', 1200), amount('--fx-drop-amp', 0, 4, 0.1, 'em')], 'enter', word()),
  fx('Entrances', 'rise', 'Rise', 'fx-rise — floats up into place. Amount is the distance.', [ms('--fx-rise-dur', 1200), amount('--fx-rise-amp', 0, 3, 0.1, 'em')], 'enter', word()),
  fx('Entrances', 'slide', 'Slide', 'fx-slide — slides in from --fx-from (-1 left, 1 right). Amount is the distance.', [ms('--fx-slide-dur', 1200), amount('--fx-slide-amp', 0, 6, 0.1, 'em')], 'enter', word()),
  fx('Entrances', 'flip', 'Flip', 'fx-flip — turns over like a card.', [ms('--fx-flip-dur', 1200)], 'enter', chip),
  fx('Entrances', 'zoom', 'Zoom', 'fx-zoom — scales in from large with a blur clearing. Amount is the start scale.', [ms('--fx-zoom-dur', 1200), amount('--fx-zoom-amp', 1, 4, 0.05, '')], 'enter', word()),
  fx('Entrances', 'shrink', 'Shrink out', 'fx-shrink — shrinks and fades out.', [ms('--fx-shrink-dur', 1000)], 'class', word()),
  {
    id: 'fx-poof',
    label: 'Poof out',
    family: 'Entrances',
    note: 'fx-poof with <Burst kind="dust">: gone in a puff.',
    subject: '.fx-poof, .fx-burst',
    dials: [ms('--fx-poof-dur', 1000), ...BURST_DIALS],
    render: (lead) => (
      <div class="fx-stage">
        <div class="fx-anchor">
          <p class={`fx-demo ${lead ? '' : 'fx-poof'}`}>Ada</p>
          {!lead && <Burst kind="dust" />}
        </div>
      </div>
    ),
  },

  fx('Loops', 'bob', 'Bob', 'fx-bob — up and down. Amount is the height.', [ms('--fx-bob-dur', 4000), amount('--fx-bob-amp', 0, 1, 0.01, 'em')], 'class', word()),
  fx('Loops', 'float', 'Float', 'fx-float — slow drift. Amount is the reach.', [ms('--fx-float-dur', 8000), amount('--fx-float-amp', 0, 1, 0.01, 'em')], 'class', tile),
  fx('Loops', 'breathe', 'Breathe', 'fx-breathe — gentle scale pulse. Amount is the peak scale.', [ms('--fx-breathe-dur', 6000), amount('--fx-breathe-amp', 1, 1.3, 0.01, '')], 'class', tile),
  fx('Loops', 'heartbeat', 'Heartbeat', 'fx-heartbeat — double pulse, then rest. Amount is the peak scale.', [ms('--fx-heartbeat-dur', 4000), amount('--fx-heartbeat-amp', 1, 1.4, 0.01, '')], 'class', tile),
  fx('Loops', 'sway', 'Sway', 'fx-sway — tilts back and forth. Amount is the angle.', [ms('--fx-sway-dur', 6000), amount('--fx-sway-amp', 0, 20, 0.5, 'deg')], 'class', chip),
  fx('Loops', 'wiggle', 'Wiggle', 'fx-wiggle — a quick shake, then rest. Amount is the angle.', [ms('--fx-wiggle-dur', 4000), amount('--fx-wiggle-amp', 0, 30, 0.5, 'deg')], 'class', chip),
  fx('Loops', 'glow-pulse', 'Glow pulse', 'fx-glow-pulse — a glow swells and fades. Amount is the radius.', [ms('--fx-glow-pulse-dur', 6000), amount('--fx-glow-pulse-amp', 0, 60, 1, 'px')], 'class', word()),
  fx('Loops', 'spin', 'Spin', 'fx-spin — slow rotation.', [ms('--fx-spin-dur', 20000)], 'class', tile),

  fx('Hits', 'shake', 'Shake', 'fx-shake — no. Amount is the distance.', [ms('--fx-shake-dur', 1200), amount('--fx-shake-amp', 0, 1, 0.01, 'em')], 'class', word()),
  fx('Hits', 'squash', 'Squash', 'fx-squash — squash and stretch. Amount is the squash.', [ms('--fx-squash-dur', 1200), amount('--fx-squash-amp', 0, 0.6, 0.01, '')], 'class', tile),
  fx('Hits', 'flash', 'Flash', 'fx-flash — a flash of brightness.', [ms('--fx-flash-dur', 1200)], 'class', word()),
  fx('Hits', 'ripple', 'Ripple', 'fx-ripple — a ring spreads out. Amount is the end scale.', [ms('--fx-ripple-dur', 2000), amount('--fx-ripple-amp', 1, 4, 0.05, '')], 'class', tile),
  fx('Hits', 'nudge', 'Nudge', 'fx-nudge — a small recoil. Amount is the distance.', [ms('--fx-nudge-dur', 1000), amount('--fx-nudge-amp', 0, 1, 0.01, 'em')], 'class', chip),
  fx('Hits', 'wobble', 'Wobble', 'fx-wobble — jelly. Amount is the skew.', [ms('--fx-wobble-dur', 2000), amount('--fx-wobble-amp', 0, 40, 0.5, 'deg')], 'class', tile),
  fx('Hits', 'tada', 'Tada', 'fx-tada — grow, tilt, settle. Amount is the scale.', [ms('--fx-tada-dur', 2000), amount('--fx-tada-amp', 1, 1.5, 0.01, '')], 'class', word()),

  fx('Text', 'wave', 'Wave', 'fx-wave on <Letters>. Amount is the height.', [ms('--fx-wave-dur', 4000), amount('--fx-wave-amp', 0, 1, 0.01, 'em'), STAGGER], 'class', letters('Ada wins')),
  fx('Text', 'rainbow', 'Rainbow', 'fx-rainbow on <Letters> — cycles the effect palette.', [ms('--fx-rainbow-dur', 8000), STAGGER], 'class', letters('Ada wins')),
  fx('Text', 'cascade', 'Cascade', 'fx-cascade on <Letters> — letters pop in one by one.', [ms('--fx-cascade-dur', 1000), STAGGER], 'enter', letters('Ada wins')),
  fx('Text', 'jitter', 'Jitter', 'fx-jitter on <Letters> — nervous letters. Amount is the twitch.', [ms('--fx-jitter-dur', 4000), amount('--fx-jitter-amp', 0, 0.3, 0.01, 'em')], 'class', letters('Ada wins')),
  fx('Text', 'type', 'Type', 'fx-type on <Letters> — types itself out.', [ms('--fx-type-dur', 300, 'Per letter')], 'enter', letters('Ada wins the round')),
  fx('Text', 'shine', 'Shine', 'fx-shine — a highlight sweeps across.', [ms('--fx-shine-dur', 6000)], 'class', word('Winner')),
  fx('Text', 'glitch', 'Glitch', 'fx-glitch — needs data-text. Amount is the split.', [ms('--fx-glitch-dur', 6000), amount('--fx-glitch-amp', 0, 0.3, 0.01, 'em')], 'class', glitchWord),
  fx('Text', 'neon', 'Neon', 'fx-neon — flickers on and holds a glow.', [ms('--fx-neon-dur', 3000)], 'enter', word()),
  {
    id: 'fx-count',
    label: 'Count up',
    family: 'Text',
    note: '<CountUp to={400} /> — rolls up to its value. Not for measurements.',
    subject: '.fx-count',
    dials: [],
    render: (lead) => (
      <div class="fx-stage">
        <p class="fx-demo">{lead ? 0 : <CountUp to={400} />}</p>
      </div>
    ),
  },

  burst('sparkle', 'Sparkle', '<Burst kind="sparkle"> — warm glints around the element.'),
  burst('dust', 'Dust', '<Burst kind="dust"> — a puff to either side.'),
  burst('confetti', 'Confetti', '<Burst kind="confetti"> — the effect palette, thrown up and falling. Runs twice the duration.'),
  burst('embers', 'Embers', '<Burst kind="embers"> — sparks drifting up. Runs 1.5× the duration.'),
  burst('stars', 'Stars', '<Burst kind="stars"> — brass stars flung out.'),
  burst('emoji', 'Emoji', '<Burst kind="emoji" glyph="🦆"> — any glyph, flung up.'),
]
```

Then change the end of the `SCENARIOS` array: after its last existing entry, before the closing `]`, add:

```tsx
  ...FX,
```

- [ ] **Step 3: Group the harness list by family**

In `client/anim/main.tsx`, change `import { render } from 'preact'` to:

```tsx
import { Fragment, render } from 'preact'
```

Replace the scenario list map:

```tsx
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              class={s.id === id ? 'btn btn--primary' : 'btn'}
              onClick={() => setId(s.id)}
            >
              {s.label}
            </button>
          ))}
```

with:

```tsx
          {SCENARIOS.map((s, i) => (
            <Fragment key={s.id}>
              {s.family && s.family !== SCENARIOS[i - 1]?.family && <p class="eyebrow">{s.family}</p>}
              <button class={s.id === id ? 'btn btn--primary' : 'btn'} onClick={() => setId(s.id)}>
                {s.label}
              </button>
            </Fragment>
          ))}
```

- [ ] **Step 4: Add the demo styles**

Append to `client/anim/harness.css`:

```css
/* --- interest kit gallery --------------------------------------------- */
.fx-stage {
  display: grid;
  place-items: center;
  min-height: 60vh;
}
.fx-demo {
  margin: 0;
  font: 800 var(--t-mega) / 1 var(--display);
  text-transform: uppercase;
  color: var(--chalk);
}
.fx-swatches {
  display: grid;
  grid-template-columns: repeat(4, 6rem);
  gap: var(--s2);
}
.fx-swatch {
  aspect-ratio: 1;
  display: grid;
  place-items: end start;
  padding: var(--s2);
  border-radius: var(--r-md);
  font: var(--t-sm) var(--mono);
  color: var(--stage);
}
.fx-tile {
  width: 6rem;
  height: 6rem;
  border-radius: var(--r-lg);
  background: var(--tungsten);
}
```

- [ ] **Step 5: Verify**

Run: `node --test client/tunables.test.ts` — expected: PASS (it now also checks every gallery dial).
Run: `npm run typecheck && npm test && npm run build` — expected: all pass.
Run: `npm run motion`, step through every `Entrances`/`Loops`/`Hits`/`Text`/`Particles` scenario, press Retrigger on each, and move one dial on each to confirm it takes effect. Confirm Save writes a moved `--fx-*` value back into the tunables block (`git diff client/style.css`), then `git checkout client/style.css` if you did not mean to keep it.

- [ ] **Step 6: Commit**

```bash
git add client/anim/scenarios.tsx client/anim/main.tsx client/anim/harness.css
git commit -m "feat: add the interest kit gallery to the motion harness"
```

---

### Task 6: Rules and catalogue in the docs

**Files:**
- Modify: `docs/design.md` §4 — replace the "Beyond that there are exactly five **anchors**…" paragraph; add an "Interest kit" subsection before the `---` that ends §4
- Modify: `AGENTS.md` — "Runtime and UI conventions"

- [ ] **Step 1: Replace the anchors paragraph in `docs/design.md`**

Replace the whole paragraph starting `Beyond that there are exactly five **anchors**` and ending `…turns a studio floor into a screensaver.` with:

~~~markdown
Six moments have their own hand-tuned motion, the **anchors**: a mark landing on
the timeline, the award, the leader's name, the buzzers opening, your own press
registering, and a vote landing. They share `--slam`, an ease that spends nearly
all its distance in the first few frames, because each one is a thing arriving
rather than a thing moving. They live under `MOTION` in `style.css`. Leave them
as they are; everything else draws from the interest kit.

### Interest kit

Reusable effects for adding interest anywhere: entrances, exits, idle loops,
hits, text effects, and particles. The classes live under `FX` in `style.css`;
`<Letters>`, `<Burst>` and `<CountUp>` live in `client/fx.tsx`. Every effect has
a scenario in the motion harness (`npm run motion`) to preview and tune it.

**Rules**

- One effect class per element. Each owns `animation` and `transform`, so nest
  a wrapper to combine two. `fx-ripple` is the exception: it draws on `::after`.
- Effects animate only `transform`, `opacity` and `filter` (`fx-shine` also
  moves its background), so they never shift layout.
- Particles never take taps.
- One-shots finish in about 600ms or less; celebrations (`fx-tada`, confetti)
  may run longer. Loops take at least 1.2s per cycle.
- Measurements stay still: cyan readouts and timing numbers never get effects.
- Colour: multicolour effects use the effect palette below; glows and sparks
  stay tungsten, brass and hot. Use a player's `--id-*` colour only when the
  effect is about that player (`--fx-color: var(--id-3)` on their name). Never
  cyan.
- Tune one element with `--fx-dur`, `--fx-amp` and `--fx-color`. Defaults live
  in `anim:tunables`. An override also reaches effects nested inside it.
- A one-shot replays when its class is removed and re-added, or when the element
  remounts with a new `key`. An exit leaves the element invisible but in place;
  unmount it on `animationend`.
- Reduced motion is handled globally in `tokens.css`; `<Burst>` renders nothing
  and `<CountUp>` shows its value at once.
- Adding an effect: its rule under `FX`, its defaults in `anim:tunables`, its
  scenario in `client/anim/scenarios.tsx`, and its row below.

**Effect palette** — `--fx-1` … `--fx-8` in `tokens.css`: coral, orange,
amber, olive, sage, periwinkle, lavender, rose. One shared lightness and a low
chroma keep them matte, and each is mixed toward `--tungsten` so it sits under
the same lamp as the set. Hues 180–230 are left out so cyan still only means a
measurement. `--fx-light`, `--fx-chroma` and `--fx-tint` in `anim:tunables`
move all eight; tune them in the harness's Palette scenario.

**Entrances and exits** — once, on mount (exits on a class arriving).

| Class | `--fx-amp` | Use for |
|---|---|---|
| `fx-fade` / `fx-fade--out` | — | Anything that should arrive quietly |
| `fx-pop` | overshoot scale | Chips, badges, a new item |
| `fx-drop` | fall distance | Something landing: a card dealt, a token placed |
| `fx-rise` | distance | Text coming up into view |
| `fx-slide` | distance; side from `--fx-from` (-1/1) | Rows joining a list |
| `fx-flip` | — | A reveal: a card turning over |
| `fx-zoom` | start scale | A title slamming in from the camera |
| `fx-shrink` | — | Leaving quietly |
| `fx-poof` | — | Leaving with a puff; pair with `<Burst kind="dust">` |

**Idle loops** — while a state lasts.

| Class | `--fx-amp` | Use for |
|---|---|---|
| `fx-bob` | height | Something waiting to be pressed |
| `fx-float` | reach | Decorative idle drift |
| `fx-breathe` | peak scale | A live control at rest |
| `fx-heartbeat` | peak scale | Time running out |
| `fx-sway` | angle | Something undecided |
| `fx-wiggle` | angle | Asking for attention every few seconds |
| `fx-glow-pulse` | glow radius; colour from `--fx-color` | Whose turn it is |
| `fx-spin` | — | Waiting, loading |

**Hits** — once, on an event.

| Class | `--fx-amp` | Use for |
|---|---|---|
| `fx-shake` | distance | Wrong, refused, locked out |
| `fx-squash` | squash | A press landing |
| `fx-flash` | — | A value changing |
| `fx-ripple` | end scale; colour from `--fx-color` | A tap, a ping |
| `fx-nudge` | distance | A small acknowledgement |
| `fx-wobble` | skew | A comic miss |
| `fx-tada` | scale | A win |

**Text** — per-letter classes go on `<Letters text="…" class="…">`.

| Class | Per-letter | `--fx-amp` | Use for |
|---|---|---|---|
| `fx-wave` | yes | height | Celebrating a name |
| `fx-rainbow` | yes | — | A winner's name, cycling the effect palette |
| `fx-cascade` | yes | — | A title arriving |
| `fx-jitter` | yes | twitch | Nerves, a close call |
| `fx-type` | yes | — (`--fx-dur` is time per letter) | A line being typed out |
| `fx-shine` | no | — | Brass and awards; not for emoji |
| `fx-glitch` | no (needs `data-text`) | split | A steal, a bust |
| `fx-neon` | no | — | A sign switching on |
| `<CountUp to from ms>` | — | — | A score rolling up; never a measurement |

Letter spacing: `--fx-stagger` sets the gap between letters for all per-letter
effects.

**Particles** — `<Burst kind glyph count>` inside a parent with `fx-anchor`.

| Kind | Looks like | Use for |
|---|---|---|
| `sparkle` | warm glints around the element | Something good appearing |
| `dust` | grey puffs to either side | Landing, leaving |
| `confetti` | effect-palette pieces, thrown and falling | A win |
| `embers` | sparks drifting up | Heat, a streak |
| `stars` | brass stars flung out | Points, a bonus |
| `emoji` | any `glyph` flung up | Reactions |

```tsx
<div class="fx-anchor">
  <p class="board__hero">{name}</p>
  <Burst key={round.id} kind="confetti" />
</div>
```
~~~

- [ ] **Step 2: Add the AGENTS.md line**

In `AGENTS.md`, in "Runtime and UI conventions", after the sentence ending `use \`npm run motion\` and its real-component scenarios.`, insert this sentence into the same paragraph:

```markdown
For interest and feedback motion, use the interest kit (`fx-*` classes and
`client/fx.tsx`; design guide §4) before writing a new keyframe.
```

- [ ] **Step 3: Check the docs**

Run: `git diff --check` — expected: no output.
Run: `grep -n "five anchors\|exactly five" docs/design.md AGENTS.md ARCHTECTURE.md` — expected: no matches.
Confirm every class named in the tables exists: `for c in fade pop drop rise slide flip zoom shrink poof bob float breathe heartbeat sway wiggle glow-pulse spin shake squash flash ripple nudge wobble tada wave rainbow cascade jitter type shine glitch neon anchor; do grep -q "\.fx-${c}[ {:,]" client/style.css || echo "missing fx-$c"; done` — expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docs/design.md AGENTS.md
git commit -m "docs: add the interest kit's rules and catalogue"
```
