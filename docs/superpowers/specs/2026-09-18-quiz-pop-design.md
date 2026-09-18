# Quiz pop: effects placed across the quiz modes

Status: draft for debate. Scope is trivia and quizbowl on the board, the phone
and the host desk. Minigames (bow, tank, ink) are out.

## Why

A tour of every quiz state in the review tool (`npm run review`) found the
moments that carry the most drama moving the least:

- Scores snap and standings rows re-sort instantly, on both the board and the
  phone dial. A lead change, the biggest event in a game, has no motion at all.
- A phone never shows its own result. After a verdict the phase goes to
  `IDLE`, so the winner's buzzer drops straight from "You're up" to "Wait —
  the host has not armed yet".
- Finishing a setlist falls back to the same dim "Ready" as any gap between
  questions.
- The lobby, the join screen and a clue arriving are all static.

The interest kit (docs/design.md §4) now has the vocabulary. This spec picks
where each effect goes, and consolidates the existing hand-tuned motions into
the kit so there is one pipeline.

## Principles

1. **Spend boldness on results.** The loudest effects go to correct, a lead
   change and the finale. Everything else gets one small effect or none.
2. **Colour keeps its meaning.** Brass is a gain, tally red is a loss, cyan is
   a measurement. Multicolour effects (confetti, rainbow) use the effect
   palette and appear only at celebrations.
3. **Never hold up the game.** No effect delays a state change, blocks a tap,
   or moves the middle band. Effects decorate a moment the wall has already
   decided; `wall.ts` stays free of appearance.
4. **The board is read from across a room; the phone is read in the hand.**
   Board effects are large and slow enough to catch from ten feet. Phone
   effects are about the player's own state and pair with the vibration the
   phone already does.
5. **The host desk stays quiet.** It is a control surface.

## Part 1: consolidate the existing motions

Today there are two motion systems: the kit's `fx-*` classes, and the anchors
and other keyframes written directly against their elements. They become one.

| New class | Keyframes it replaces | Used by |
|---|---|---|
| `fx-warm` | `warm` | `.filament` |
| `fx-stamp` | `stamp`, `aftershock`, `bloom` | `.timeline__mark`, `__pin`, `__name` |
| `fx-strike` | `strike` | `.board__award` |
| `fx-slam` | `slam`, `flare` | `.board__hero` |
| `fx-punch` | `punch` | `.buzzer.is-open` |
| `fx-land` | `land` | `.buzzer.is-first` |
| `fx-cast` | `cast`, `cast-flare` | `.vote` |
| `fx-sweep` | `pending-sweep` | `.pending__sweep` |
| `fx-ring` | `ink-ring`, `ink-ring-still` | `.ink-ring` |

Rules for the move:

- **Tuning is untouched.** Every existing tunable (`--slam-dur`,
  `--flare-fall`, `--stamp-dur`, `--bloom-dur`, `--punch-dur`, …) keeps its
  name and value. Each new class resolves `--_d` from `--fx-dur` and falls back
  to the existing tunable, the same pattern as the rest of the kit.
- **Keyframes are renamed with the `fx-` prefix** and move into the FX section
  of `style.css` as a new "Signature" family.
- **Multi-part anchors stay multi-part.** `fx-stamp` is one class on the mark
  that drives the pin and name through child selectors, so the three
  keyframes can't be separated by accident. `fx-slam` keeps its two animations
  (slam and flare) on one element; it is the documented exception to
  "one effect owns `animation`", like `fx-ripple`.
- **Call sites switch to the class** where the element is rendered in JSX
  (hero, award, timeline mark, vote). State-driven ones (`.buzzer.is-open`,
  `.buzzer.is-first`, `.filament`) keep their state selector and are added
  to the class's selector list (`.fx-punch, .buzzer.is-open { … }`), because
  the class there is the state.
- **Harness:** the six anchors' existing scenarios move under a "Signature"
  family heading. No new scenarios are needed for them.
- **Docs:** design.md §4 drops the separate "anchors" paragraph. The kit table
  gets a Signature section listing these nine, marked "hand-tuned: change the
  tunable, not the curve".

The rule "Leave them as they are" becomes "Their tunables are hand-tuned; use
the classes anywhere, but don't edit their keyframes."

## Part 2: placements

Each row is one moment. "Effect" names a kit class or component; a new one is
marked **new**.

### Board

| # | Moment | Element | Effect |
|---|---|---|---|
| B1 | Any score change | Standings row | Row slides to its new rank (**new** `useFlip` helper, below). Score uses `CountUp` from its old value. |
| B2 | Score went up / down | Standings row | `fx-flash` in brass / tally red. |
| B3 | Lead changes | 1st place rank label | `fx-tada` once. |
| B4 | `verdict:award` | Hero name | Confetti `Burst` from the name, then one `fx-shine` pass after the slam lands. |
| B5 | `verdict:award` | Answer line | `fx-rise`. |
| B6 | `verdict:penalty` | Hero name | `fx-shake` once, at the recolour (not at the arrival). |
| B7 | `verdict:penalty` | −points stamp | Dust `Burst` from under the stamp. The stamp keeps `fx-strike`. |
| B8 | Photo finish: second mark within `--photo-finish` (default 30ms) of first | Second mark's `+ms` readout | `fx-flash` in cyan. It is a measurement, so cyan is correct. |
| B9 | Clue fragment arrives | Newly said words | Fade in over `--fast`. Today words appear at once. |
| B10 | `duel:faceoff` | The two names | `fx-slide` in from opposite sides; "vs" gets `fx-pop`. |
| B11 | `duel:dead` | "Both missed" call | `<Glitch>`. |
| B12 | Player joins | Their standings row | `fx-drop`. |
| B13 | Lobby, no players yet | QR | `fx-glow-pulse` until the first join. |
| B14 | Setlist block advances | Position chip | `fx-flip`. |
| B15 | **Setlist complete** | Middle band | Finale, see below. |

### Phone

| # | Moment | Element | Effect |
|---|---|---|---|
| P1 | Own score changes | Bar score | `CountUp`, then `fx-flash` brass / tally red. |
| P2 | Own correct answer | Buzzer | Sparkle `Burst`. The label stays whatever `phoneOf` says. |
| P3 | Press registered ("In") | Buzzer | `fx-squash`. |
| P4 | Locked out ("Out") | Buzzer | `fx-shake` once, with the existing vibration. |
| P5 | Frozen by an item | Buzzer label | `<Glitch>`. |
| P6 | Answering, last 3s of the window | Countdown | `fx-heartbeat`. |
| P7 | Rank changes | Standings dial row | Same `useFlip` slide as B1. |
| P8 | Vote cast | Nominee button | `fx-nudge`. |
| P9 | Seated in a duel | Heads-up card | `fx-tada` once. |
| P10 | Item received | Item button | `fx-pop` plus a sparkle `Burst`. |
| P11 | Item used | Item button | `fx-poof`. |
| P12 | Join screen shows | "Party Buzzer" mark | `fx-wave` once (`<Letters>`). |

### Host

| # | Moment | Element | Effect |
|---|---|---|---|
| H1 | Action refused | The button that sent it | `fx-shake` once. |

Nothing else on the host desk.

### The finale (B15)

The one placement that needs new wiring. Today a finished setlist shows
"Ready".

- `wall.ts` gets a new moment, `idle:finale`, when `setlist` exists and every
  block is done. The middle band's new occupant is
  `finale: { name: string }`, the top of `standings`. A tie shows every tied
  name.
- The board shows the name as `fx-rainbow` at hero size, with a confetti
  `Burst` on arrival and a second one 1.2s later.
- Phones show `phoneOf` label "Winner" (mood `first`) for the winner and
  "Final" with their rank as the sub for everyone else. The winner's buzzer
  also gets P2's sparkle.
- It lasts until the host clears or loads another setlist.

This changes `wall.ts`'s moment list, so it needs `wall.test.ts` cases for the
new moment's priority (below every verdict, above `idle:ready`).

## New code

- **`useFlip(listRef)`** in `client/fx.tsx`: before each render it records every
  child's `data-key` position; after the render it plays the difference as a
  `transform` transition over `--base`. It is about 20 lines on the
  First-Last-Invert-Play pattern, with no dependency. Rows are already keyed.
- **Score deltas:** `CountUp` needs the previous value. The standings row keeps
  it in a ref, and the row's flash colour comes from the sign of the change.
- **Retriggering one-shots** on an element that stays mounted (B2, B6, P1,
  P3, P4, H1): a small `useHit(dep)` helper in `fx.tsx` that removes and
  re-adds a class across a reflow when `dep` changes, the same trick `Glitch`
  uses for flashes.
- **`idle:finale`** in `shared/wall.ts` and its projection in `phoneOf`.
- **Tunable:** `--photo-finish: 30ms` in `anim:tunables`.

Every new effect site gets a harness scenario only if it introduces a new
combination (the finale, the standings slide). Single kit classes are already
in the harness.

## Fixes found on the tour

- **Review fixture `correct`** leaves the phase at `LOCKED`, so the board never
  shows the award stamp or the answer. It should go to `IDLE` with `order`
  kept, which matches `server/state.ts`.
- **Talk screen** ("Say it out loud") renders flush left and wraps into the
  edge at 390px; the "7s" countdown is at `--t-xs`. Center it and make the
  countdown readable.
- **Add review fixtures** for the new states: lead change, finale, frozen.

## Reduced motion

`tokens.css` already cuts every animation to 1ms. `Burst`, `CountUp` and
`Glitch` already opt out. `useFlip` skips the transform when reduced motion is
set, so rows just move.

## Testing

- Unit: `useFlip`'s delta maths and the finale moment in `wall.test.ts`.
- Visual: the review tool at each moment, plus the motion harness for the
  Signature family after the rename.
- Walkthroughs (`walk-setlist` reaches the finale) are run by hand.

## Delivery order

1. Consolidation (Part 1). It's a rename with no visible change, so it's
   checked by eye in the harness before and after.
2. Standings motion: B1–B3, P1, P7.
3. Correct and wrong: B4–B7, P2–P4.
4. The finale: B15.
5. Everything else.

## Out of scope

- Minigame surfaces.
- New sounds. Effects pair with the existing cues; new cues are a separate
  pass.
- Theming per mode (trivia and quizbowl look the same).
