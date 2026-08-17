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

### Ink

| Token | Hex | Use |
|---|---|---|
| `--chalk` | `#f5f0e6` | Anything being read now. Warm white, so it belongs to the set. |
| `--dim` | `#8a8073` | Eyebrows, chips, hints, anything not being read now. |

### Signal — warm carries drama

| Token | Hex | Means |
|---|---|---|
| `--tungsten` | `#ffb454` | Armed, charging, the primary action, the question's value. |
| `--tally` | `#ff3b2f` | Live. The buzzers are open, or something is destructive. |
| `--brass` | `#c9a227` | First place, correct, awarded, connected. |
| `--silver` | `#b8bcc4` | Second place, in the standings dial. |
| `--bronze` | `#b0793f` | Third place, in the standings dial. |
| `--ember` | `#7a3b10` | A lamp with no current in it yet. Filament only. |
| `--hot` | `#fff6e8` | White-hot filament at full power. Filament and open buzzer only. |

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

Board type is viewport-relative because it is read across a room. Host and phone
type is fixed because it is read at arm's length. Don't mix the two.

### Tracking

`--track-label` (`0.14em`) on anything uppercase and small. `--track-hero`
(`-0.01em`) on display type at hero sizes. Nothing else gets tracking.

---

## 4. Space, form, motion

**Space** is a 4px base: `--s1` (4px) through `--s8` (64px). Use the tokens; a
one-off `13px` is how a system dies.

**Radius** is tight on purpose — `--r-sm` 2px, `--r-md` 4px, `--r-lg` 10px. Tight
radii read as equipment; generous ones read as a consumer app. The single
exception is `--r-buzzer` (28px), because the buzzer is a physical object in
someone's hand.

**Motion** is `--fast` (80ms) for anything under a finger, `--base` (160ms) for
layout, both on `--ease`. The filament is the only animation whose duration is
data rather than taste — it runs for whatever time is left before the buzzers
open. `prefers-reduced-motion` is honoured globally in `tokens.css` — you don't
have to handle it per component.

Beyond that there are exactly five **anchors**: a mark landing on the timeline,
the award, the leader's name, the buzzers opening, and your own press
registering. They share `--slam`, an ease that spends nearly all its distance in
the first few frames, because each one is a thing arriving rather than a thing
moving. They live together under `MOTION` in `style.css`, all one-shot, all
fired by an element mounting or a class arriving — no timers, no JS. Add a sixth
only for a moment the room would otherwise miss; anything animated because it
could be is what turns a studio floor into a screensaver.

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
<span class="chip chip--live">Live</span>       <!-- buzzers open -->
<span class="chip chip--armed">Standing by</span> <!-- lead-in -->
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

Each figure animates on mount (`cast`, anchor 6), which is why `Votes` keys by
voter id: the arriving vote must be the element that mounts, and taking a vote
back must not restart the ones that stay.

### Flow strip and builder — `.host__flow`, `.flow`

The setlist has two very different readers, so it gets two very different
treatments. The play strip (`.host__flow`) says where the room is right now —
block, mode, question count, a duel flag — and sits above `.host__controls`,
unfolded, because a host who has to open a disclosure to learn what round it
is will not do it. The builder (`.flow`, inside `FlowPanel`) is setup, not
play: it lives folded away in the host's manage details beside `GameSettings`,
one block per row with its own mode, question count, value and duel rule,
reordered with `↑`/`↓` rather than drag, because a game night's flow is short
enough that two buttons beat a pointer library. The block the room is running
rails brass (`.flow__block.is-here`) — the same colour the board uses for a
leader — so scrolling the builder mid-game still shows which row is live.

The board gets one chip, not the strip. The stage belongs to the question; a
setlist that pulls the eye during a buzz has failed at its job, so the board's
share of it is `N/total · QM of count`, sized and coloured like every other
status chip, competing for no more attention than "3 players" does.

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
an ordinal; the dial is a ranking, not a photo finish. The tilt angle comes from scroll position in JS;
`scroll-snap-type: y proximity` settles a row into the band without trapping
the flick.

---

## 6. The two signatures

Spend boldness in one place. Everything above is deliberately quiet so these two
can carry the design.

### The filament — `.filament`

Arming is scheduled ~300 ms ahead so every phone opens on the same real instant
(see `ARM_LEAD_MS`). Rather than hide that gap, every surface shows it: a cold
filament draws left to right and heats from `--ember` to `--hot`, landing exactly
when the buzzers open. The room *feels* "go" coming instead of being surprised by
it, which is the whole point of a synchronised start.

```html
<div class="filament" style="--lead: 300ms" />   <!-- warming -->
<div class="filament is-hot" />                  <!-- open, held at full -->
```

Two rules:

- `--lead` is **time actually remaining** (`armedAt - now()`), not the constant.
  A client that heard late gets a shorter warm-up, never a wrong one.
- Key the element on `round.armedAt` so the animation restarts once per arm and
  not on every unrelated broadcast.

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

Grid: stage on the left, a `clamp(17rem, 23vw, 26rem)` sidebar on the right.
Everything on the stage is `--t-mega` or larger. Status chips sit top-left so the
centre stays clear for the moment that matters.

States, in priority order:

1. **Result** — hero name in brass, timeline beneath, and the brass award stamp
   once the host has scored it.
2. **Buzzers open** — "Buzz" in tally, filament at full.
3. **Standing by** — "Stand by", filament warming, question value.
4. **Idle** — "Ready", dim.

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

The QR is full size until the first player joins, then shrinks to a corner.
Between questions it is still there for latecomers, just not eating the wall.
Connection state sits at the bottom of the sidebar as a `.lamp` — the room
never needs it, but the host glancing at the wall does. The standings mark
the podium with `.rank` medals (1st/2nd/3rd in brass, silver, bronze); below
third there is no number, because the order already says it.

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

Setup lives in a collapsed `<details>` because it is not play — during a game the
controls own the screen. Inside, four eyebrow-labelled blocks in the order a
night is actually set up: **Game**, **Flow**, **Room** (teams mode, the teams
themselves, mirroring), **Players**. Every block carries an eyebrow and the panel
spaces them itself, so no control inside it sets its own margin. Teams mode and
Add team sit together under Room; a control separated from the switch that
enables it reads as belonging to neither.

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
| Lead-in | Wait | Any moment |
| Open | Buzz | — |
| Pressed, still collecting | In | Counting the rest of the field |
| Buzz missed the window | In | Too late — the round closed first |
| Won | You're up | Answer it |
| Placed | +20 ms | Someone beat you to it |
| Locked out | Out | Wrong answer — you sit out the rest of this question |

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

**Keep the verb through the flow.** The button says "Arm"; the board says
"Standing by"; the chip says "Live". Each names a different moment, so each gets
its own word — but "Arm" always means arm, everywhere.

**Sentence case everywhere** except eyebrows, chips, and key hints, which are
uppercase because they are labels rather than sentences. Display type on the
board is uppercased in CSS, not in the string, so the data stays readable.

**Explain the dead end.** Never show a disabled control with no reason. "Out" is
useless; "Out — wrong answer, you sit out the rest of this question" tells the
player exactly what happened and when it ends.

**No apologies and no exclamation marks.** The tally light is doing the shouting.

---

## 9. Seeing it move

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

## 10. Adding something new

1. Can an existing component do it? Use it.
2. Is it drama or measurement? That answers the colour and the typeface.
3. Does it need a token that doesn't exist? Then either it's wrong, or the
   system is missing something real — add it to `tokens.css` and to this
   document in the same commit.
4. Nothing may reference a CDN, a webfont service, or a remote image.

Before shipping, remove one thing.
