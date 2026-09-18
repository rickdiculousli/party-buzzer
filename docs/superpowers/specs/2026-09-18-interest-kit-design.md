# Interest kit

A reusable set of motion and flair effects (entrances, exits, idle loops, hits,
text effects, particles) that any element in the game can use, plus the rules
for using them and a gallery to preview and tune them.

This replaces the design guide's "exactly five anchors" restraint rule. Effects
may be used anywhere they add fun. The existing hand-tuned anchors (`stamp`,
`strike`, `slam`, `punch`, `land`, `cast`, with their glows) are left as they are.

First pass: the kit, the doc, and the gallery. Wiring effects into game moments
is later work, one moment at a time.

## Catalogue

Class names are the API. Every effect reads its uniform overrides
`--fx-dur`, `--fx-amp`, `--fx-color`, falling back to its own default.

### Entrances and exits (play once)

| Class | What it does |
|---|---|
| `fx-fade` | Fade in (`fx-fade--out` to fade out) |
| `fx-pop` | Scale up past full size, then settle |
| `fx-drop` | Fall in and squash on landing |
| `fx-rise` | Float up into place |
| `fx-slide` | Slide in; side from `--fx-from` (`-1` left, `1` right) |
| `fx-flip` | Rotate in about the Y axis like a card |
| `fx-zoom` | Scale in from large with a blur clearing |
| `fx-shrink` | Shrink and fade out |
| `fx-poof` | Shrink out; pair with `<Burst kind="dust">` |

### Idle loops (keep running)

| Class | What it does |
|---|---|
| `fx-bob` | Move up and down |
| `fx-float` | Slow drift on two axes |
| `fx-breathe` | Gentle scale pulse |
| `fx-heartbeat` | Double pulse, then rest |
| `fx-sway` | Tilt back and forth |
| `fx-wiggle` | Small quick rotation shake, then rest |
| `fx-glow-pulse` | Glow (`drop-shadow` in `--fx-color`) swells and fades |
| `fx-spin` | Slow continuous rotation |

### Hits (play once on an event)

| Class | What it does |
|---|---|
| `fx-shake` | Horizontal shake |
| `fx-squash` | Squash and stretch |
| `fx-flash` | Brightness flash to white-hot |
| `fx-ripple` | Ring expands out from the element (pseudo-element) |
| `fx-nudge` | Small recoil |
| `fx-wobble` | Jelly skew wobble |
| `fx-tada` | Grow, tilt left-right, settle |

### Text effects

Per-letter effects need `<Letters>`; the rest apply to a whole element.

| Class | Per-letter | What it does |
|---|---|---|
| `fx-wave` | yes | Letters move up and down in sequence |
| `fx-rainbow` | yes | Letters cycle through the effect palette |
| `fx-cascade` | yes | Letters pop in one after another |
| `fx-jitter` | yes | Letters twitch at random offsets |
| `fx-shine` | no | A highlight band sweeps across the text (`background-clip: text`) |
| `fx-glitch` | no | Offset copies split the text briefly (pseudo-elements from `data-text`) |
| `fx-neon` | no | Flickers on like a sign, then holds a glow |
| `fx-type` | yes | Types itself out, one letter every `--fx-type-dur` |
| count-up | — | `<CountUp>` rolls a number up to its value |

### Particles

`<Burst kind>` with kinds `sparkle`, `dust`, `confetti`, `embers`, `stars`,
`emoji` (takes `glyph`).

### Effect palette

Eight matte, warm-tinted hues, `--fx-1`…`--fx-8` in `client/tokens.css`, so
multicolour effects never read as belonging to a player:

```css
--fx-1: color-mix(in oklab, oklch(var(--fx-light) var(--fx-chroma) 25), var(--tungsten) var(--fx-tint));
```

Hues 25 coral, 55 orange, 85 amber, 120 olive, 150 sage, 265 periwinkle, 305
lavender, 345 rose. Nothing between 180 and 230, so cyan stays the measurement
colour. The shared knobs `--fx-light` (0.76), `--fx-chroma` (0.09) and
`--fx-tint` (18%) live in `anim:tunables`, and a Palette scenario in the gallery
tunes all eight at once.

## Rules

These go into `docs/design.md` §4.

- One effect class per element: each owns `animation` and `transform`, so nest a
  wrapper to combine two. `fx-ripple` is the exception; it draws on `::after`.
- Effects animate only `transform`, `opacity`, and `filter` (plus
  `background-position` for `fx-shine`), so they never shift layout.
- Particles are `pointer-events: none` and never take taps.
- One-shots finish in about 600ms or less. Only celebrations run longer.
- Loops take at least 1.2s per cycle.
- Measurements stay still: cyan readouts and timing numbers never get effects.
- Multicolour effects (rainbow, confetti, glitch) use the effect palette
  `--fx-1`…`--fx-8`; glows and sparks stay tungsten, brass and hot. A player's
  `--id-*` colour is used only when the effect is about that player, through
  `--fx-color`. Never cyan.
- Reduced motion is handled by the global rule in `tokens.css`; `<Burst>` and
  `<CountUp>` also check `prefers-reduced-motion` and skip straight to the end.
- Adding an effect means updating three places: its CSS in the `FX` section, its
  gallery entry, and its row in the design guide.

## Build

### CSS — `client/style.css`

- A new `FX` section after `MOTION`: one rule and keyframe per effect.
- Each effect's defaults go in the `anim:tunables` block (`--fx-pop-dur`,
  `--fx-wave-amp`, …) so the harness Save writes them without changes.
- Each rule reads `var(--fx-dur, var(--fx-pop-dur))`-style fallbacks so a caller
  can override one element without touching the default.
- Per-letter effects stagger with `animation-delay: calc(var(--i) * var(--fx-stagger))`.

### Helpers — `client/fx.tsx`

- `Letters({ text, class })`: splits `text` into words, and each word with
  `Intl.Segmenter` (grapheme granularity) into `<span style="--i:n">`. Each word
  is a `nowrap` span so a line never breaks mid-word. A visually hidden copy of
  the text is read by screen readers; the letter spans are `aria-hidden`.
- `Burst({ kind, glyph?, count? })`: an absolutely positioned,
  `pointer-events: none` layer filling its positioned parent. Each particle gets
  random angle, distance, spin, and delay as custom properties; CSS does the
  motion. The layer unmounts itself when the last particle's `animationend`
  fires. Renders nothing under reduced motion. Remount (new `key`) to fire again.
- `CountUp({ to, from?, ms? })`: `requestAnimationFrame` from `from` to `to`
  with an ease-out, cancelled on unmount; under reduced motion shows `to` at once.

### Gallery — `client/anim/scenarios.tsx`

- An `FX` array (id, label, family, dials, demo render) generates one scenario
  per effect, appended to `SCENARIOS`. The demo is a real element (a word, a
  chip, a buzzer) so the effect is judged in context.
- The harness scenario list groups by family. Replay and Save work as they do
  for the existing moments.

## Doc changes

- `docs/design.md` §4: keep the Motion paragraph (durations, eases). Rewrite the
  anchors paragraph to say the six anchors are hand-tuned moments that stay as
  they are. Add an "Interest kit" subsection with the rules above and one table
  per family: class, one-shot or loop, dials, one-line example.
- `AGENTS.md`: one line under runtime and UI conventions: use the interest kit
  before writing a new keyframe.

## Testing

- Client tests run under plain Node with no DOM and cannot import `.tsx`, so the
  logic the helpers need lives in pure functions in `client/fx.ts`:
  `graphemes(text)`, `words(text)`, `particles(kind, count, rand, glyph)` and
  `countAt(from, to, k)`. `client/fx.tsx` only
  renders them.
- `client/fx.test.ts`: `graphemes` keeps emoji and combining marks whole;
  `words` splits on whitespace runs; `particles` returns the requested count, each with the
  custom properties its kind's keyframe reads, deterministic under a seeded
  `rand`.
- Extend `client/tunables.test.ts`: every `--fx-*` default referenced in the
  `FX` section and every gallery dial is declared in `anim:tunables`.
- The gallery is the visual check; run `npm run motion` and step through each
  effect.
