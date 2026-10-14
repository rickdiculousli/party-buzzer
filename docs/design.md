# Party Buzzer Design System

Three surfaces, one identity. This document is the source of truth for how they
look and what they say. Tokens live in `client/tokens.css`; components live in
`client/style.css`. If this document and those files disagree, one of them is a
bug — fix it, don't work around it.

---

## 1. The idea

**A television studio floor that is also a timing instrument.**

Everything on screen is either *drama* or *measurement*, and the two never share
a colour:

| | Drama | Measurement |
|---|---|---|
| What it is | Who is up, what is live, who won | Milliseconds, scales, ticks |
| Colour | Warm — tungsten, tally red, brass | Cold — cyan |
| Typeface | Big Shoulders, condensed and huge | Plex Mono, tabular |
| Where it belongs | Board hero, buzzer, host actions | Timeline, deltas, readouts |

The rule is absolute: **cyan never indicates state, and warm colours never carry
a measurement.** A player who learns "cyan means a number" on the board reads the
host panel correctly the first time they see it.

### Why this and not something else

A buzzer app is a game show at heart, and game show hardware is tungsten lamps,
a red tally light, and brass fittings on black staging. But this particular
buzzer's whole reason to exist is that it adjudicates to the millisecond. A
purely theatrical design throws that away; a purely instrumental one is no fun
at a party. Keeping both, and keeping them visually separate, is the design.

---

## 2. Colour

### Surface

| Token | Hex | Use |
|---|---|---|
| `--stage` | `#0b0a08` | The room. Page backgrounds on all three surfaces. |
| `--panel` | `#16130f` | A lit surface sitting on the stage. Sidebars, rows, sections. |
| `--raise` | `#211c16` | A row or control on a panel. One step only — never stack three. |
| `--rule` | `#2c2620` | Hairlines, borders, an unlit lamp. |
| `--stone` | `#2e2d2b` | A true grey for what floats over the set, such as the backing behind Sketch's chat lines. Used translucent, so it reads over both the stage and a lit surface. |
| `--paper`, `--typed`, `--graphite` | `#bdb3a0`, `#231e17`, `#3b3833` | A paper prop on the set, its typewriter ink, and pencil. Paper is kept dim so it never outshines a screen. Phantom Ink's discarded prompts. |

### Ink

| Token | Hex | Use |
|---|---|---|
| `--chalk` | `#f5f0e6` | Anything being read now. Warm white, so it belongs to the set. |
| `--dim` | `#8a8073` | Eyebrows, chips, hints, anything not being read now. |

### Signal — warm carries drama

| Token | Hex | Means |
|---|---|---|
| `--tungsten` | `#ffb454` | Armed, charging, the primary action, the question's value, a name that has buzzed and is not yet judged. |
| `--tally` | `#ff3b2f` | Open. The buzzers are taking presses, or something is destructive. |
| `--brass` | `#c9a227` | First place, correct, awarded, connected. On the board hero, only ever a result. |
| `--silver` | `#b8bcc4` | Second place, in the standings dial. |
| `--bronze` | `#b0793f` | Third place, in the standings dial. |
| `--hot` | `#fff6e8` | White-hot at full power. Open buzzer and glow cores only. |

### Signal — cold carries measurement

| Token | Hex | Means |
|---|---|---|
| `--cyan` | `#4dd8e6` | Milliseconds, ticks, scales. Never a state. |

### Identity ramp

`--id-1` … `--id-6`. The one place outside the core palette. Players and teams
need hues that stay apart across a room, which a warm-only set can't supply.
Assigned by index or by a hash of the id — **never by meaning**. A player is not
red because they are losing.

**No identity colour may equal a signal colour.** A name rendered in `--cyan`
reads as a measurement and a name in `--tungsten` reads as armed, which is
exactly the confusion section 1 exists to prevent. If you extend the ramp, check
the new hue against the signal table first.

Use `colorFor(key)` from `client/ui.ts`, which hashes the id so a player keeps
their colour when someone above them leaves.

### Contrast

`--chalk` on `--stage` is 15.9:1. `--dim` on `--stage` is 6.4:1 — fine for
labels, never for anything you must read to play. Signal colours are used at
large sizes or as fills behind dark text; don't set `--tally` as small body text
on `--panel`.

---

## 3. Typography

Two faces, both self-hosted in `client/public/fonts` as latin-only `.woff2`
(~56 kB total). **Nothing may reference a CDN — the party WiFi has no route to
the internet.**

**Big Shoulders** (`--display`), variable 400–900. A condensed American signage
face. Every name, every call, every number the room reads from ten feet. It is
condensed, so long names fit without shrinking.

**IBM Plex Mono** (`--mono`), 400 and 600. Everything else: UI, labels, inputs,
and all data. Mono as the interface face is deliberate — it makes the host panel
read as a control desk, and it gives tabular figures everywhere for free.

There is no third face. If something needs a new one, it needs a new role, and
it probably doesn't have one.

### Scale

| Token | Size | Use |
|---|---|---|
| `--t-hero` | `clamp(4rem, 15vw, 14rem)` | Board only. The name, the call. |
| `--t-mega` | `clamp(2.5rem, 7vw, 6rem)` | Board idle state. |
| `--t-xl` | `clamp(1.75rem, 3.4vw, 3rem)` | Board secondary — the question value. |
| `--t-lg` | `1.5rem` | Section heads, standings rows, host major buttons. |
| `--t-md` | `1rem` | Body. |
| `--t-sm` | `0.8125rem` | Controls, inputs, secondary text. |
| `--t-xs` | `0.6875rem` | Eyebrows, chips, key hints. Always uppercase and tracked. |
| `--t-chip-board` | `clamp(0.95rem, 1.25vw, 1.6rem)` | Board only. Every chip on the board, the QR captions and the join address; the setlist chip at 1.2×. |

Board type is viewport-relative because it is read across a room. Host and phone
type is fixed because it is read at arm's length. Don't mix the two.

### Tracking

`--track-label` (`0.14em`) on anything uppercase and small. `--track-hero`
(`-0.01em`) on display type at hero sizes. Nothing else gets tracking; board
chips keep `--track-label` at their larger size because they are still labels.

---

## 4. Space, form, motion

**Space** is a 4px base: `--s1` (4px) through `--s8` (64px). Use the tokens; a
one-off `13px` is how a system dies.

**Radius** is tight on purpose — `--r-sm` 2px, `--r-md` 4px, `--r-lg` 10px. Tight
radii read as equipment; generous ones read as a consumer app. The single
exception is `--r-buzzer` (28px), because the buzzer is a physical object in
someone's hand.

**Motion** is `--fast` (80ms) for anything under a finger, `--base` (160ms) for
layout, both on `--ease`. `prefers-reduced-motion` is honoured globally in `tokens.css` — you don't
have to handle it per component.

The first family of the interest kit is **Signature**: the hand-tuned motions
the round was built around. They share `--slam`, an ease that spends nearly
all its distance in the first few frames, because each is a thing arriving
rather than a thing moving. Each is also a class, so any element can wear it.
Their tunables are hand-tuned; change a tunable, not a curve.

| Class | What you see | Where |
|---|---|---|
| `fx-pin-flash-drop` | Pin drops onto the rail; a glow flashes at touchdown and fades | A timeline mark |
| `fx-rubber-stamp` | Fades in large, overshoots small, settles | The award |
| `fx-hero-slam-glow` | Fades in large with a glow in its tone already lit, cooling | The leader's name |
| `fx-buzz-snap` | Already visible; snaps from slightly large to size | Buzzers opening |
| `fx-press-flash` | Background flashes white-hot, settles into its colour | Your press registering |
| `fx-vote-drop-glow` | Falls from above, lands with a small glow | A vote |
| `fx-loading-sweep` | A bar slides across a track, looping | Pending states |
| `fx-touch-ring` | A ring swells and fades | Ink touches |

`fx-hero-slam-glow` and `fx-vote-drop-glow` run two animations on one element;
like `fx-ripple`, they are exceptions to "one effect per element".

### Interest kit

Reusable effects for adding interest anywhere: entrances, exits, idle loops,
hits, text effects, and particles. The classes live under `FX` in `style.css`;
`<Letters>`, `<Burst>`, `<CountUp>` and `<Glitch>` live in `client/fx.tsx`. Every effect has
a scenario in the motion harness (`npm run motion`) to preview and tune it.

**Rules**

- One effect class per element. Each owns `animation` and `transform`, so nest
  a wrapper to combine two. `fx-ripple` is the exception: it draws on `::after`.
- Effects animate only `transform`, `opacity` and `filter` (`fx-shine` also
  moves its background), so they never shift layout.
- Particles never take taps.
- One-shots finish in about 600ms or less; celebrations (`fx-tada`, confetti)
  may run longer. Loops take at least 1.2s per cycle, except `fx-jitter`,
  whose whole point is a fast twitch.
- Measurements stay still: cyan readouts and timing numbers never get effects.
- Colour: multicolour effects use the effect palette below; glows and sparks
  stay tungsten, brass and hot, except the board hero's glow, which follows
  its verdict tone (so a miss flares tally). Use a player's `--id-*` colour only when the
  effect is about that player (`--fx-color: var(--id-3)` on their name). Never
  cyan, with one exception: `<Glitch>` uses pure cyan, magenta and yellow
  (Display-P3 where the screen has it), because a channel split only reads as
  one in the printer's primaries.
- Tune one element with `--fx-dur`, `--fx-amp`, `--fx-color` and (slides)
  `--fx-ease`. Defaults live in `anim:tunables`. An override also reaches effects nested inside it.
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
| `fx-slide` | distance; side from `--fx-from` (-1/1); rate from `--fx-ease` | Rows joining a list |
| `fx-flip` | — | A reveal: a card turning over |
| `fx-zoom` | start scale | A title slamming in from the camera |
| `fx-shrink` | — | Leaving quietly |
| `fx-poof` | — | Leaving with a puff; pair with `<Burst kind="dust">` |

Slides take one of three rates, curves in `tokens.css`:
`fx-slide--glide` (`--rate-glide`, the default: fast then slow, arrives and
settles), `fx-slide--charge` (`--rate-charge`: slow then fast; it ends at full
speed, so put something at the stop, like dust) and `fx-slide--even`
(`--rate-even`: eases both ends, for moving between two places).

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
| `fx-flash--tint` | also flashes the text to `--fx-color` | A score going up (brass) or down (tally) |
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
| `<Glitch text>` | no | shove | A steal, a bust: hits of stutter (1–3× `--fx-glitch-dur`, 300ms, random per hit) then a breather (`--fx-glitch-rest`, ±20%: 2–3s by default) with one to four single flashes bunched near its ends, so it wanes and waxes. Cyan/magenta/yellow channels flicker through quadrant windows and a band of the letters tears, with a new cut every hit |
| `fx-neon` | no | — | A sign switching on |
| `<CountUp to from ms>` | — | — | A score rolling up; never a measurement |

`--fx-stagger` sets the delay between letters for `fx-wave` and `fx-cascade`.
`fx-rainbow` always puts each letter one palette step behind the last.

**Particles** — `<Burst kind glyph count from angle spread>` inside an element
with `fx-anchor`. `from` is where particles start: `center` (the default),
`edge` (the whole outline, spread by each side's length), one side (`top`,
`bottom`, `left`, `right`) or a list of them (`{['left', 'bottom', 'right']}`).
They go toward `angle` (degrees, 0 is right, 90 is down) if given, outward for
`edge` or a list, and in the kind's own direction otherwise;
`spread` fans either side of it (60° by default). Distance is `--fx-amp`.

| Kind | Looks like | Use for |
|---|---|---|
| `sparkle` | warm glints around the element | Something good appearing |
| `dust` | grey puffs to either side | Landing, leaving |
| `confetti` | effect-palette pieces, thrown and falling | A win |
| `embers` | sparks drifting up | Heat, a streak |
| `stars` | brass stars flung out | Points, a bonus |
| `emoji` | any `glyph` flung up | Reactions |

Put the burst inside the element it celebrates. It sizes itself from that
element's font, so a burst on a hero name is hero-sized and one on a chip is
chip-sized. For an exit, put it beside the leaving element rather than inside,
or it shrinks away with it.

```tsx
<p class="board__hero fx-anchor">
  {name}
  <Burst key={round.id} kind="confetti" from="top" />
</p>
```

**Helpers** in `client/fx.tsx`: `useFlip(listRef)` slides a list's children
to a new order (children need `data-key`; it moves them with `translate`, so
they can wear a transform effect too). `useDelta(value)` gives a number's last
change and a count to key a replay on. `<ScoreChange score>` counts to a new
score and flashes brass going up, tally going down; still on first render.

---

## 5. Components

### Eyebrow — `.eyebrow`

The structural label above a block. Uppercase, tracked, `--dim`, with a rule that
runs to the end of the container.

```html
<p class="eyebrow">Standings</p>
```

The rule is the structure. **Do not number sections `01 / 02 / 03`** — nothing on
these surfaces is a sequence, so numbering would encode something untrue. The one
place ordinal position is real is the buzz order, and that is drawn as a
timeline, where position carries the actual milliseconds.

### Chip — `.chip`

A small piece of state. Never a control, never clickable.

```html
<span class="chip">6 players</span>
<span class="chip chip--open">Open</span>       <!-- buzzers open -->
<span class="chip chip--armed">Standing by</span> <!-- the arm delay -->
<span class="chip chip--won">Winner</span>
<span class="chip chip--barred">Amy out</span>
<span class="chip chip--data">150 ms window</span>
```

If it does something when you press it, it is a `.btn`, not a chip. There is no
hover state on a chip, and that is how you tell.

### Lamp — `.lamp`

Connection, at a glance. The dot carries the state and the word says it out
loud — a dot alone is ambiguous from across the room.

```html
<span class="lamp">
  <span class="lamp-dot is-on" /> Connected
</span>
<span class="lamp"><span class="lamp-dot is-off" /> Disconnected</span>
```

A bare `.lamp-dot` (no word) is only for repeating rows, like the per-player
list on the host panel, where a word on every line would be noise.

### Readout — `.readout`

Any number that is data. Tabular figures and slashed zero. Add `--ms` when the
number is a duration, which turns it cyan.

```html
<span class="readout">1400</span>
<span class="readout readout--ms">+20 ms</span>
```

Scores are `.readout` but **not** `--ms` — a score is drama, not measurement.

### Votes — `.votes`

A nomination tally, counted in heads rather than digits: one 👤 per vote, drawn
from `<Votes voters={…} />` so all three surfaces count the same way. It sizes
off the type it sits beside — room-scale on the board, thumb-scale on the phone
— and is warm-tinted by a filter on the container rather than given a swatch,
because "a crowd" is neither drama nor measurement and the palette should not
grow a third register for it.

```html
<span class="votes"><span class="vote">👤</span><span class="vote">👤</span></span>
```

A vote is never a `.readout--ms`; nothing about it is a duration. The host desk
is the one place a digit rides alongside, because that screen calls the close.

Each figure animates on mount (`fx-vote-drop-glow`), which is why `Votes` keys by
voter id: the arriving vote must be the element that mounts, and taking a vote
back must not restart the ones that stay.

### Setlist strip and builder — `.host__setlist`, `.setlist`

The setlist has two very different readers, so it gets two very different
treatments. The play strip (`.host__setlist`) says where the room is right now —
block, mode, question count, a duel flag — and sits above `.host__controls`,
unfolded, because a host who has to open a disclosure to learn what round it
is will not do it. The builder (`.setlist`, inside `SetlistPanel`) is setup, not
play: it lives on the Games tab, one block per row with its own game — a quiz
mode, or a minigame, which is one visit and drops the quiz fields — and for a
quiz block its question count, value, pack and duel rule,
reordered with `↑`/`↓` rather than drag, because a game night's setlist is short
enough that two buttons beat a pointer library. The block the room is running
rails brass (`.setlist__block.is-here`) — the same colour the board uses for a
leader — so scrolling the builder mid-game still shows which row is running.

The board gets one chip, not the strip. It names the mode and the actual
positions: `Quizbowl-lite · Block 2/3 · Question 1/2`. A minigame block names
the minigame and block without a question count. This chip is 1.2 times the
board chip size and in chalk rather than dim, but stays at the top-left edge
so it does not compete with the question in the middle of the stage.

### Button — `.btn`

```html
<button class="btn">Next question</button>
<button class="btn btn--primary">Arm</button>       <!-- tungsten -->
<button class="btn btn--go">Correct +100</button>   <!-- brass -->
<button class="btn btn--no">Wrong −100</button>     <!-- tally -->
<button class="btn btn--ghost">Undo</button>
```

Add `.btn--major` for the three controls the host presses all night. They get
display type and roughly triple the visual weight of everything else on the
panel. **At most three majors on a screen** — if everything is major, nothing is.

### Key hint — `.key`

Rides inside a button and names its shortcut. Every host control that has a key
shows it; a shortcut nobody can discover isn't a feature.

```html
<button class="btn btn--major btn--primary">Arm<span class="key">Space</span></button>
```

### Field and input — `.field`, `.input`

```html
<label class="field">
  Value
  <input class="input input--num" type="number" />
</label>
```

The label is uppercase and tracked; the input resets to sentence case, because
you type into it.

### Stepper — `.stepper`

A number you adjust far more often than you retype. Both the buttons and the
field stay live — the buttons for speed, the field for a big correction.

```html
<span class="stepper">
  <button class="btn btn--ghost">−</button>
  <input class="input input--num" type="number" />
  <button class="btn btn--ghost">+</button>
</span>
```

Score steppers move by the current question value, not by a fixed 100, because
that is the amount a host is actually correcting.

### Row — `.row`

One competitor, one line. The left border is the identity colour and is the only
place identity colour appears in a list.

```html
<li class="row" style="border-left-color: var(--id-3)">
  <span class="row__label">Bea</span>
  <span class="row__score readout">1400</span>
</li>
```

`.row.is-lead` for first place: brass border, warm fill. Wrap rows in `.stack`,
which handles the list reset and gaps.

### Standings dial — `.dial`

Phone only. The standings through a window five rows tall; the rest of the
field is a scroll away. The window is a well, not a panel: sunk below the
stage under a hard inner shadow that wraps all four sides, so the list reads
as sitting behind glass set into the surface. The shadow rides an overlay
above the rows — as an inset on the element it would paint under them, and
unshaded identity rails running to the edge are what read as flat. A masked blur frosts the outer 15% at each edge, and a
hairline divider sits between rows, held in to the middle three-quarters so
it reads as etched rather than as a box edge.

```html
<div class="dial">
  <ol class="dial__list">
    <li class="dial__row" style="--id: var(--id-3)">
      <span class="dial__name">Bea</span>
      <span class="dial__score readout">1400</span>
    </li>
  </ol>
  <div class="dial__glass" />
</div>
```

Identity colour is the left border, same rule as `.row`, and scores are
`.readout` but never `--ms`. Each row leads with its ordinal — 1st, 2nd, 3rd
in brass, silver, and bronze, the rest in `--dim`. Ties share a score but not
an ordinal; the dial is a ranking, not a photo finish. The dial rests on
your own row: on mount and after each reorder it scrolls you into the band,
unless a finger touched it in the last second. The tilt angle comes from scroll position in JS;
`scroll-snap-type: y proximity` settles a row into the band without trapping
the flick.

### Spoken line — `.board__spoken`

What the judge heard, quoted on the board: the transcript of the leader's
spoken answer, in curly quotes — the judge's verdict lands with the line, so
it is brass (`is-hit`) when it earned the points and tally (`is-miss`) when
it did not, from its first frame. An
empty transcript reads as "no answer", which is itself a verdict.

```html
<p class="board__spoken is-hit">“photosynthesis”</p>
<p class="board__spoken is-miss">“respiration”</p>
```

It lives in `board__above`, above the award stamp, because evidence belongs
with the payoff: the room reads what was said and what it scored in one
glance. The three-band layout keeps the hero name pinned at centre, so the
line arriving or leaving never moves it. And it outlives a rebound the way
the award does — a wrong answer hands the question to the next in the order, the
collection window is gone, but what the first player said is still the story
the room is reacting to, so it stays up until the next question arms.

### Chat — `.sketch-chat`

A stream of what the room is typing, the way a stream's chat overlay runs:
Sketch's guesses on the board. `SketchChat` in `client/SketchParts.tsx`; the
rules it runs on are pure functions in `client/sketch.ts`.

**How it looks.** A column centred on the drawing's right border, half over the
drawing and half beside it, so it reads as laid over the work without hiding
it. Each line is one line tall (a long guess ends in an ellipsis): the name in
its identity colour, bold display caps, then the text. Every line sits on its
own backing of `--stone` at 55%, a true grey that shows over the lit drawing
and the black stage alike. A right guess is brass, "got it" and its time as a
cyan `.readout`. The type steps down on a short stage so ten lines still fit.

```html
<div class="sketch-chat">
  <ol class="sketch-chat__list">
    <li class="sketch-chat__line is-got"><span class="sketch-name" style="--id: …">Ada</span> got it <span class="readout readout--ms">+1.02s</span></li>
    <li class="sketch-chat__line"><span class="sketch-name" style="--id: …">Bo</span> barn</li>
  </ol>
</div>
```

**How it moves.** One list, bottom-anchored, and it moves like a train of
carriages:

- **Deque.** `pushChat` adds new lines to the back; past ten it drops the
  oldest wrong guess. Order never changes, so wrong guesses always leave from
  the slot under the right ones, and a right guess that reaches that slot stays.
  Right guesses ride in with everything else and lock in on arrival: there is
  no second list, and nothing fades mid-column.
- **Train.** A new line pushes every line above it up one slot together. Each
  line slides from wherever it is drawn right now (`chatStarts`), so a line
  arriving mid-slide continues the motion instead of restarting it. A new
  line joins exactly one gap behind the line it follows, even while that line
  is still moving.
- **Wipe, not fade.** A dropped line leaves the flow but stays in the list
  where it was, finishing its slide. Each frame it is cut off at the top edge
  of the line rising into its slot (`wipeCut`), so the two never overlap and
  nothing lingers. It is removed when the slide ends: a line is gone when it
  has slid out, not when the deque lets go of it.
- **Timing.** A slide is 260 ms on `--ease`. One that starts mid-slide ends
  about when the current one would, plus a quarter slide, never longer than
  260 ms and never shorter than 90 ms (`chatSlideMs`). A burst moves faster
  and still settles on time.
- **Measure against what does not move.** Positions are read against the chat
  column, never the list: a bottom-anchored list moves as a whole while it
  fills, and a line's place in it does not, so measuring against the list sees
  no motion and snaps. Start a transition's first value before the forced
  reflow, or the browser has nothing to animate from. Frames arrive many times
  a second; only a change to the lines may start a slide, or every frame
  restarts it.

**How to test it.** The rules are pure, so they are unit-tested by simulation:
`client/sketch.test.ts` models bottom-anchored slots on the real `--ease`
curve, runs seeded random bursts through `pushChat`, `chatStarts`,
`chatSlideMs` and `wipeCut`, and checks every 5 ms of simulated time. Lines
never come within the gap of each other, a new line starts one gap behind the
line it follows, a dropped line never reaches its neighbours, and everything
comes to rest. When changing the rules, break one on purpose and see the test
fail. The simulation cannot see the DOM layer (what is measured against what,
transition start values, frame ordering); a change there still wants one live
look under `npm run sim-sketch`.

Reuse it for any list the room watches fill in real time.

### Set dressing — props on the studio floor

The studio has props. A game that needs a world of its own (a minigame keeps its
own table rather than the quiz's frame) builds it from these, in the house's
parts and colours, rather than inventing a new look. Each recipe below carries
the rules that make it read right.
Phantom Ink is the reference build (`client/InkParts.tsx`, `client/style.css`).

#### CRT screen — `.ink-screen`, `.ink-set`

A television in the studio: content shown as signal on a tube. Layers, bottom to
top:

| Layer | What it is |
|---|---|
| Tube | `--screen`, a dark radial, inside curved corners and an inset shadow. |
| Signal | The content. Ink and lettering carry a faint phosphor glow (`--phosphor`). |
| Snow | One noise layer across the whole tube (`::after`). |
| Live | The glow and refresh band of whatever is live right now. |
| Glass | Scanlines, an overhead sheen and a vignette over everything (`::before`). |

- **One tube, one layer.** Whatever belongs to the tube spans the glass edge to
  edge and is feathered on every side. A glow or band cut to an element's box
  shows the box, and the eye reads it as an overlay.
- **Bound to what reads, not to the box.** A row reads from the baseline above
  to its own baseline; its box sits lower. Place the live layer to match what
  the eye sees, and let a band fade out at the line.
- **Light is overhead and centred.** An off-centre sheen makes everything under
  it look lopsided. Measure brightness left against right when something looks
  off.
- **Snow is no signal.** One layer, thick where nothing has been written and a
  faint grain (`--snow-floor`) under what is on air, the change feathered over
  half a row. Never snow in separate boxes.
- **Signal arriving** opens like a CRT line and settles with a slip
  (`ink-tune`), once.
- **Live** is a slightly brighter tube and a soft refresh band: thin, one
  peak, rolling slowly (5.2 s). A block cursor blinks only where slots are
  fixed, as with typed letters; freehand has no next slot, so it shows the beam,
  a white-hot dot at the pen's tip, only while ink is going down.
- **Lettering on the tube** goes through the pixel grid (`#ink-px`), so it
  reads as the set's own type without a third face.
- **The set** is a bezel with a chin: a label, a roster, and a pilot lamp lit
  tungsten when it is that side's turn. Angle sets a few degrees toward the
  room. The chin never widens the set (`contain: inline-size`): a name
  shortens, and names that do not fit become "+N".
- On a phone the screen stands bare and takes the height that is left, its
  rows sized to fit; a lone row is its own glass.
- Snow, tune-in, band and blink hold still under reduced motion.

Tunables sit together in `style.css`: `--scan-alpha`, `--snow-alpha`,
`--snow-floor`, `--phosphor`.

#### Paper and pencil — `DiscardSlip`, `.ink-slip`

Paper props on the set: notes, slips, cards.

- **Paper is a prop, kept dim** (`--paper`) so it never outshines a screen.
  Type is `--typed`, pencil is `--graphite`.
- **Torn, not cut.** A `clip-path` edge: small teeth where it was ripped along a
  perforation, bigger bites where it tore freehand. The shadow goes on a
  wrapper as `drop-shadow`, because `clip-path` cuts off a `box-shadow`.
- **Typed** in Plex Mono with a slight bleed: a typewriter without a third face.
- **Scribbled out** in pencil: a few loose passes back and forth, drifting down
  the text, through `#ink-pencil` (the line wobbles on the paper's tooth and the
  grain breaks it up). The text stays just legible under it. A scribble reads as
  thrown away; a single strike line reads as picked, so never use one for a
  discard.
- **Seeded from the content** (`mulberry32` in `shared/random.ts`), so its tear,
  tilt (±4°) and scribble hold still across renders.
- **A pile** stacks newest on top at full brightness, older ones darker behind
  it, fading out at the bottom rather than pushing anything.
- **Handwriting** is freehand strokes: chalk with phosphor on a tube, graphite
  on paper. Fake hands (sims, fixtures) print stroke capitals, one letter to a
  slot, each point wobbled a little (`GLYPHS` in `tools/sim-ink.ts`).

The filters live in `InkDefs`, mounted once per surface. They carry Ink's
names; when a second game uses them, move them to a shared defs component.

#### Phantom Ink

Each team's page is a CRT set; each team's discarded prompts stack as paper
slips on its set's outer side. Sun and Moon are `--team-sun` (`--id-1`) and
`--team-moon` (`--id-3`): identity hues, never signal ones. Set `--team` from
the `--sun`/`--moon` modifiers. A peek letter is written in the page's team
colour, and a peek row carries an eye.

#### Poker — the late room (`.felt`, `.poker-card`, `.poker-rail`)

A card room after midnight: one lamp over the table, felt to every edge, dark
all round. There is no rail and no table border on either surface; the cloth
runs off the screen and a vignette drops it into `--felt-rim`, so the table
feels bigger than the screen. The felt is layered, not flat: `--felt-grain`
(fine noise), `--felt-nap` (a faint directional sheen) and `--felt-mottle`
(slow blotches), all inline SVG noise, over a `--felt` to `--felt-deep`
gradient. A warm lamp pool sits over the middle; on the board a second pool
follows the player to act, and on the phone the lamp brightens on your turn.

Marks on the cloth are paint soaked into the pile, never UI type or a flat
film: `FeltMark`, `FeltArc` and the betting line take `--felt-ink` casino
gold through the `--paint-fibre` mask, so the paint takes on most fibres and
misses some and the green shows through, as paint does on turf. Where it took,
the paint still has the pile's texture: `--paint-grain` fibre noise is
overlaid on it, and the felt's own grain and nap lie over it at the felt's
scale (`PaintPile` does the same inside SVG), so a painted stroke is never a
flat colour. A soft
`--felt-press` shadow of the surrounding pile seats it in the cloth. The phone carries its two instructions on arcs, the way a table
carries "insurance pays 2 to 1". The board has a painted betting line and the
Party Buzzer mark in the middle, where the board cards and the pot lie on top
of it as they would on a real table; no printed mark ever crosses another.
Every noise tile's frequency times its size is whole, so tiles meet without a
seam, and the slow mottle is one untiled sheet.

Cards are poker size (63 × 88 mm), radius 5.6% of the width, with ivory
`--card-face` stock, a hairline and a `--card-edge` cut edge, and a shadow
that falls away from the lamp. Corner indices (rank over a drawn suit pip)
read when cards overlap; `--suit-red` and `--card-ink` print them. Face cards
carry simple two-ended portraits in the same suit ink: a feathered cap for
the Jack, a low tiara and long outward-curling hair for the Queen, a crown and
beard for the King. Suit symbols stay in the corner indices.
Ivory cutouts define the faces and collars, with no frame around the portrait.
Backs are a
white margin around an oxblood `--card-back` diamond lattice. A card has both
sides, so turning it over is a real flip. Suits are drawn SVG, never glyphs.
Chips are casino chips in five `--chip-*` inks with edge spots, stacked by
`chipStack`. Slightly oval tops, the table seen a little from the front, sit above thin striped edges, every chip the
same size, each raising the top of the stack by a small amount; a stack stands
on its spot and rises from there. Shadow length conveys height without a long
extrusion. A call or raise lands on top of the bet already there. The pot is a
corral of stacks round its middle, and a swept bet usually lands on a stack
already there. The edge facing away from the lamp stays near black across its far quarter and
softens around the sides into the lit edge. Chips run a little more saturated than their inks, and tops are matte: a faint,
soft hotspot on the side facing the lamp, fainter the further the stack stands from it. One shadow per stack falls away
from the table's centre lamp; taller stacks cast it further. The pot lays every
shadow on the felt under every chip, and draws its stacks back to front, so a
nearer, taller stack covers the tops behind it. A taller stack also shades the
top of a lower neighbour on the side away from the lamp: its chip-sized column
drawn out into an oval, one chip step per chip of drop, clipped to that top. A tight dark
contact edge and a lightly softened cast shadow give the stack weight.
CSS layers fake the depth without
3D geometry or a blur on every chip. The dealer puck is a white disc marked
Dealer. The phone's
actions sit on a stitched leather rail (`--leather`) as plaques; reactions
are printed tokens on the cloth. Win % and the shot clock stay cyan readouts
without effects.

Motion follows hands and cloth, not keyframes: `client/toss.ts` moves a card
in two phases. In the air it is fast and loses little speed, spinning freely;
at touchdown the cloth takes over, drag slows it exponentially and a little
constant friction finally stops it, so it crawls the last stretch. Touchdown
bites into the spin and the cloth drags the rest off faster than the slide, so
a card spins in flight and barely turns once it is skidding. How much it spins
comes from the throw: a dealer's pitch, or how hard a player flicked. A soft
flick or a timeout pushes the cards instead: they ride the hand, speed up, and
are let go straight into the skid. Chips are pushed the same way. Dealt cards are not placed: each lands loose where its pitch leaves it
(`scatter`), up to half a card off its place and turned up to 22°. Once the
second is down, the player takes a moment (150–450 ms, their own), gathers
the pair still a little askew, and taps it twice from above with a
fingertip, pressing it into the cloth, square halfway then square (`receive`,
tuned by `RECEIVE`); no two players tap with quite the same depth or rhythm.
The dealer keeps no metronome either: `dealSchedule` varies the gap before
each card, and every pitch leaves the fingers at its own speed and spin. Cards come to rest a few degrees off square,
fixed per card. The flop lands face down and turns together; a fold is a light
fingertip toss, low and short, that always stops a few card widths short of
the board cards (`KEEP_CLEAR`); seats sit far enough back to leave it room.
Its spin varies widely but mostly low, and now and then one card of the pair,
never both, gets away and spins (`wildCard`). A fold lies where it stopped
for a beat, then pops away (`fx-poof`); there is no discard pile on the table. Bets slide to the line and are
swept into the pot as a street closes; the pot slides to the winner. A level
change prints over a dark oval so it reads over the play.

A player out of the tournament is stamped, not announced: a thin boxed word in
faded `--stamp-ink`, masked by `--stamp-wear` so the rubber takes unevenly,
across the lower edge of their dimmed name. It never floats on a plate or a
shadow, because by then it is the least important thing on the table. Tunables live in `TOSS`; the harness's Poker
scenarios preview the deal and the three kinds of fold.

---

## 6. The signature

Spend boldness in one place. Everything above is deliberately quiet so this
can carry the design.

### The timeline — `.timeline`

The buzz order is a measurement, so the board draws it as one. Each mark sits at
its real millisecond on a shared scale: the room *sees* that Bea beat Amy by
20 ms instead of reading it. Cold colours only — this is instrumentation, and the
warm hero name above it is the drama.

```html
<div class="timeline">
  <div class="timeline__rail" />
  <ol class="timeline__marks">
    <li class="timeline__mark" style="--at: 18%; --id: var(--id-2)">
      <span class="timeline__pin" />
      <span class="timeline__name">Amy</span>
      <span class="timeline__ms readout">+20</span>
    </li>
  </ol>
  <div class="timeline__scale"><span>0 ms</span><span>112 ms</span></div>
</div>
```

**The scale is fixed at 0–1000 ms**, never autoranged. Collection always runs
exactly one second, so the rail always means the same thing: a photo finish
reads as a photo finish instead of being stretched across the wall, and two
questions can be compared by eye.

**Marks stack into rows.** A mark drops to the next row down whenever its labels
would collide with what is already beside it, so a cluster becomes a staircase
rather than a pile. Its connector then runs the whole way from the rail to its
own name — and the names carry an opaque background so a connector passing
behind one breaks around it instead of striking through. That background is the
entire reason the labels have one.

**One window, ordered by press time.** Collection runs for a full second after
the first buzz, and every buzz inside it is a contender: the clamped press stamp
alone decides the order, so a slow phone carrying an early stamp still takes the
lead — even after a faster packet has already been shown in front.

Shown only when two or more people buzzed — a timeline with one mark is noise.

---

## 7. Surfaces

### Board — read from across the room

Grid: the wall (`.board__wall`) on the left, a `clamp(17rem, 23vw, 26rem)`
sidebar on the right. Everything on the wall is `--t-mega` or larger, except
the status chips, which sit top-left at `--t-chip-board` so the centre stays
clear for the moment that matters.

States, in priority order:

1. **Result** — hero name in tungsten while they answer, timeline beneath;
   brass with the brass stamp once the host has scored it, tally with the
   tally stamp on a miss.
2. **Buzzers open** — "Buzz" in tally.
3. **Arming** — whatever was up holds until the buzzers open: the next-question
   card, or the miss on a rebound.
4. **Idle** — "Ready", dim.

A **choice question** keeps the three bands, but lifts the middle one
(`.board__wall.is-choice`, a 0.55 : 1.45 split, the lane sized to the question)
for the whole question so the grid has room. The question holds the middle from
the arm, and the options rise in as a two-column grid of raised, lettered
panels (`.board__choices`, `fx-rise`) in the band below once it has been read.
While picking, a row above the grid holds a small pill bar (`.board__slots`)
with a slot per player, filling in that player's colour when they pick, in pick
order, so the room sees who is still out but never what anyone chose, and the
countdown is the seconds left, huge and faded behind the whole wall
(`.board__countdown`). The row keeps its space at the reveal so the grid never
moves. When the last pick lands, or the countdown runs out, the bar warms to
brass for a beat (`.is- closed`, with a brass `fx-ripple`) so the room sees
that everyone is in before it is told who was right. On the reveal each pick's
dot lands on the top edge of the answer it chose, three quarters showing
(`.board__who`); the right cell turns brass with `fx- tada`, the rest dim
(`.is-dim`) with their dots, and the brass stamp above reads "+400 · 2 right"
or "Nobody". Its moments are `choice:listening`, `choice:picking` and
`choice:reveal`; there is no hero. The option box (`.choice__cell`,
`.choice__letter`) is shared with the phone, which shows the same panels as its
pick buttons and the seconds left above them (`.player__countdown`).

**The leader shows early, the field fills in.** A beat after the first buzz
(150 ms — long enough for the true photo finish to land) the board lights up
with the provisional leader, and the timeline keeps filling for the rest of the
second as the room trickles in. The lead can still change hands on a slow packet
carrying an earlier stamp; that is the race, watched live.

**The result outlives the button that caused it.** Scoring a question sets an
award and leaves the order on screen; only arming the next question clears it.
The room looks at the board *after* the host scores, not before, so the payoff
has to still be there. That is also why the host's Correct and Wrong go dead
once a question is scored — the order is still up, so the buttons have to be
the thing that stops.

The QR is full size while the room is arriving (nobody yet, the lobby, a first
block's introduction), with the join address printed under it for a phone that
will not scan; then it shrinks to a corner. The standings win the sidebar: a
long lobby roster shrinks the code, never the list.
Between questions it is still there for latecomers, just not eating the wall.
Connection state sits at the bottom of the sidebar as a `.lamp` — the room
never needs it, but the host glancing at the wall does. The standings mark
the podium with `.rank` medals (1st/2nd/3rd in brass, silver, bronze); below
third there is no number, because the order already says it.

**The milestone is a murmur, the recap is the encore.** A milestone (`.board__milestone`)
is one dim line in the stakes corner, under the chip, for the question or match
it belongs to; it never enters the middle band and never covers the hero. At the
finale the winner and confetti play as before; about 2.5 s after the name
appears, a recap band (`.board__recap`) hangs under it and cycles the night's
recap cards, one every 4 s, each rising in. The sidebar's code then points at
`/recap` ("Scan to keep the night"), so a phone can keep the cards and the final standings.

### Arrival — the lobby and the introduction

Two moments that sit above everything else. The **lobby** is a Test buzzer:
the phone shows one buzzer ("Test buzzer", sub "Practice only · no points"),
the board lists the roster with a Tested/Not yet chip, and a press lights the
name for a moment with the existing `fx-flash`. The **introduction** names the
first block and its goal; the phone shows a "Waiting for the host" chip and no
control. Neither is a round: no points, no readiness gate, no new keyframes.
The board covers its old content while one is up; the QR and identity bars stay.

### Host — a control desk driven by the keyboard

The host is on a laptop and presses the same five controls all night, so every
one has a key and shows it:

| Key | Action |
|---|---|
| `Space` | Arm |
| `C` | Correct |
| `W` | Wrong (with penalty) |
| `N` | Next question |
| `Z` | Undo |

Shortcuts never fire while focus is in an input, a select, or a
`contenteditable`, and never with a modifier held.

**Undo is server-side** and goes back 20 host actions. Awarding points to the
wrong player is the mistake a host actually makes, and it was previously
unrecoverable without hand-editing a score.

The desk is three tabs (`.host__tabs`, current one railed brass) under one bar
that always says what is running and holds Undo:

- **Play** — the only page that changes with the room: the quiz desk, the match
  desk while a minigame is up, or an "Open <minigame>" button when the setlist
  sits on a minigame block. The quiz desk keeps compact live standings beneath
  the buzz order; Players has score editing. Keys fire only here, and never
  under a minigame.
- **Games** — how the night runs (direct play or setlist), the setlist builder,
  then one fold per game (`.host__game`, a `<details name="game">` accordion):
  the quiz (mode, pack, reading) and each minigame (its options and Open).
- **Players** — roster, the minigame lobby's sides, teams, scores. Reachable
  during a match, and the roster actions stay legal there.

Every block carries an eyebrow and the page spaces them itself, so no control
inside it sets its own margin. The teams grouping and Add team sit together; a
control separated from the switch that enables it reads as belonging to neither.

### Phone — one object in one hand

The buzzer fills everything below a single status bar. The player's name is
rendered in their identity colour, so you can tell whose phone you picked up.
Below the buzzer, the standings sit behind glass as a dial (see `.dial`):
five rows through a clear window, the rest of the field a scroll away under
frosted edges.

Every buzzer state carries a subtitle saying *why*, because a dead button with no
explanation is the worst thing this app can do:

| State | Label | Subtitle |
|---|---|---|
| Idle | Wait | The host has not armed yet |
| Delay | Wait | Any moment |
| Open | Buzz | — |
| Pressed, still collecting | In | Counting the rest of the field |
| Buzz missed the window | In | Too late — the round closed first |
| Won | You're up | Answer it |
| Placed | +20 ms | Someone beat you to it |
| Locked out | Out | Wrong answer — you sit out the rest of this question |
| Locked, no press | Locked | Someone else is answering |
| Correct answer | Right | The points actually awarded, including a mode bonus |

"In" is the phone knowing something the room does not. It is purely local — the
room sees nothing for the first 150 ms, and a buzzer that looks unchanged after
a press feels broken. The placing appears when the round locks, even though the
board has been filling in live.

Feedback is layered, since a phone may be face-down on a knee:

| Event | Haptic | Tone |
|---|---|---|
| Buzzers open | `[40, 40, 40]` | 440 Hz, 150 ms |
| You buzzed | `60` | 660 Hz, 150 ms |
| Locked out | `[120, 60, 120]` | 180 Hz, 260 ms |

Low and long means bad news; short and high means go. You can tell them apart
from another room.

---

## 8. Writing

**Name things by what the player controls.** "Buzz", not "Submit". "Remove", not
"Kick" — you are managing a party, not moderating a forum.

**Keep the verb through the round.** The button says "Arm"; the board says
"Standing by"; the chip says "Open". Each names a different moment, so each gets
its own word — but "Arm" always means arm, everywhere.

**Sentence case everywhere** except eyebrows, chips, and key hints, which are
uppercase because they are labels rather than sentences. Display type on the
board is uppercased in CSS, not in the string, so the data stays readable.

**Explain the dead end.** Never show a disabled control with no reason. "Out" is
useless; "Out — wrong answer, you sit out the rest of this question" tells the
player exactly what happened and when it ends.

**No apologies and no exclamation marks.** The tally light is doing the shouting.

---

## 9. Canon words

One word per thing, one thing per word. These are settled; when something
needs a name, check here before minting one, and when prose here and code
disagree, the code is what gets renamed.

- **round / question / block** — a round is one arm-to-verdict cycle; a
  question is the pack content being read; a block is one segment of a
  setlist. A round is not a question is not a block.
- **value / points / score** — `round.value` is what is at stake,
  `award.points` is what was awarded, `state.scores` is what has accumulated.
- **pick / buzz** — a pick is a player's answer on a choice question
  (`round.picks`); a buzz is a press for the floor. A choice question has no
  buzz and no leader.
- **order / standings** — `round.order` is the buzz order. The score ranking
  is the standings, never "the order".
- **leader / hero** — the leader is `order[0]`, a fact about the round; the
  hero is the `Wall`'s big name, a thing on the screen.
- **read** — the box reads; nothing else does. `Reader`, `state.reading` and
  `act:read` own the word. Reading a file is prose, never an identifier.
- **open** — one sense only: a thing becoming available (`useOpen`,
  `openRebound`, `openDuel`). The arm countdown is the **delay**
  (`ARM_DELAY_MS`), and **lead** is only a position in the buzz order — the
  lead changes hands, it is never a duration.
- **live** — retired as a label. The buzzers-open chip is `.chip--open` and
  reads "Open"; nothing on screen says "Live".
- **cue / recipe / layer / bed / clip** — a cue is what a moment plays; a
  recipe is its layers; a layer is one source under an envelope; a bed is a
  loop; a clip is a rendered file. A "sample" is just a file-sourced layer.
- **hold / sustain** — the hold is the beat a miss holds the wall before its
  rebound opens (`round.held`); sustain is an envelope segment. The envelope
  never holds and the verdict never sustains.
- **segment** — attack, decay, sustain and release are an envelope's four
  segments. "Stages" for them is retired.
- **mode / grouping** — the mode is the game module (`setMode`,
  `server/modes/`); solo vs teams is the grouping. The old warning about two
  things called "mode" is retired by this line.
- **setlist** — the ordered blocks a night plays through, and the strip that
  shows them. "Flow" for this is retired; a flow is a river's.
- **pool / seated / buzzable** — the pool is a duel's nominees, the seated are
  the pair facing off, the buzzable are who may buzz right now
  (`round.buzzable`). Nobody is a finalist.
- **spoken / answer** — spoken is the player's transcript (`round.spoken`,
  `POST /spoken`); the answer is the revealed correct one (`round.answer`).
- **wall / stage** — `board__wall` renders the `Wall`. `--stage` is only the
  backdrop colour, and the word belongs to the theatrical metaphor, never to
  a region or a position in a sequence.
- **match / minigame / field** — a match is one synchronized minigame
  start-to-results cycle; a minigame is the kind of play; its shared 2D space
  is the field. A match is not a question, and the field is not the stage.
- **street / hand / table** — in Poker a street is one betting round (preflop,
  flop, turn, river), a hand is one deal to its pot, and the match is the whole
  tournament. The table is Poker's field. None of them is a round. Pressing the
  cards to see them is a **peek**, and folded cards pausing mid-table
  **linger**; neither is a hold. Players still contesting a pot are "in the
  hand", never live.
- **guess / drawer** — a guess is a typed answer in Sketch or Phantom Ink,
  never a pick or a buzz; the drawer is the player drawing this Sketch turn.
  A Sketch turn is not a round.
- **night / fact / milestone / recap card** — the night is the ledger of what
  happened since the room was last cleared; a fact is one entry in it; a
  milestone is the one-line recognition shown mid-night ("New leader: Dee");
  a recap card is one finale card (title, name, detail). A milestone's "leader"
  is the top of the standings, not `order[0]`, and only appears in its copy.
- **game / quiz** — a game is anything on the host's Games tab: the quiz or a
  minigame. The quiz is the buzzer play, whichever mode it runs; "trivia" is
  one of those modes, never the whole quiz.

Poker motion costs (peek meshes, shadow masks, texture caps) live with their audit evidence in
[docs/audits/poker-animation/README.md](audits/poker-animation/README.md#poker-motion-costs).

---

## 10. Seeing it move

Static screens lie about a design that only exists over time. `npm run sim`
fills the room with bots that buzz like people — uneven skill, uneven reflexes,
uneven wifi — and plays real questions against a running server, so you can
watch the board and a phone across a game instead of guessing.

```
npm run sim                 # against http://localhost:8080
npm run sim -- 5            # stop after five questions
npm run sim -- 5 2          # five questions, half speed, for looking closely
```

It is an ordinary client: real sockets, real protocol, real clock sync, no
test-only hooks in the server. Question difficulty varies, so you get gimmes
(six marks inside 100 ms) and stumpers (one mark, or nobody) in the same run —
which is the only way to know the timeline works. Wrong answers trigger real
rebounds and lockouts. Ctrl-C removes the bots.

You can join from a phone mid-run and play against them.

**What it revealed:** with collection ending at 150 ms, the board almost always
showed a single mark — everyone slower than the winner's first 150 ms was
dropped before the room ever saw them. Collection now runs a full second so the
board shows the room instead of the one fastest thumb, and the provisional
leader appears 150 ms in so the room is not staring at a dead stage while it
fills.

---

## 11. Adding something new

1. Can an existing component do it? Use it.
2. Is it drama or measurement? That answers the colour and the typeface.
3. Does it need a token that doesn't exist? Then either it's wrong, or the
   system is missing something real — add it to `tokens.css` and to this
   document in the same commit.
4. Nothing may reference a CDN, a webfont service, or a remote image.
5. Every surface is one screen with nothing colliding: no scrolling, every
   box inside the viewport, and no two boxes overlapping unless one holds the
   other. `npm run test:review` checks this on every review scenario at two
   board and three phone sizes (`tools/review/fits.spec.ts`). An overlap that
   is the point, like the faded countdown behind the wall, carries
   `data-overlap` in the markup; decoration that is `aria-hidden` is exempt.

Before shipping, remove one thing.
