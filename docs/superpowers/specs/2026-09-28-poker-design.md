# Poker minigame design

No-limit Texas Hold'em as a standalone full game night: one table, a
freezeout to one winner, blinds that rise on a clock. Phones are the
players' hole cards and a small felt table under their thumbs; the board is
the table the room watches. The tournament never touches the standings.

Minigame id `poker`, display name "Poker".

## Decisions

- One match is one whole tournament. It runs untimed through the minigame
  runtime, like Phantom Ink, and ends when one player holds every chip.
- No-limit Hold'em, 2–10 seats, freezeout: no rebuys, no late entry.
- Blinds double on a level clock so a night ends in roughly 45–90 minutes.
- A shot clock auto-checks when checking is free and auto-folds otherwise.
  A disconnected player keeps the seat, posts blinds, and is auto-acted.
- No score commit. Results carry finishing places for the results screen;
  every result has `points: 0`.
- The tournament survives a server restart by checkpointing at the start of
  each hand. The interrupted hand is voided.
- The hand evaluator is written here, not added as a dependency.

## Words

Canon words (design.md §9) already own round, hold, open, pick, live and
stage, so poker avoids them.

| Poker idea | Word used | Not |
| --- | --- | --- |
| A betting round | street (`preflop`, `flop`, `turn`, `river`) | round |
| One deal to its pot award | hand | round |
| The whole tournament | match | game |
| Pressing the cards to see them | peek | hold |
| Cards pausing mid-table after a fold | linger | hold |
| Players still contesting the pot | in the hand | live |
| The shared table area | table (the minigame's field) | stage |

The canon section gains a **street / hand** line when this ships.

## Rules as implemented

- Seats are the connected players at Start, in a seeded random order. The
  button starts on a seeded random seat and moves one seat left each hand.
- Blinds: small blind left of the button, big blind left of that. Heads-up,
  the button posts the small blind and acts first preflop, last after.
- Levels: the big blind starts at the `bigBlind` option and doubles every
  `levelMin` minutes of play; the small blind is half, rounded down to a
  whole chip. A level change takes effect at the next hand. No antes.
- Streets: preflop, flop (3), turn (1), river (1). Action starts left of the
  big blind preflop and left of the button after.
- Legal actions: fold; check when nothing is owed; call; bet or raise to an
  amount; all in. A raise must add at least the previous bet or raise on this
  street (minimum one big blind). An all-in short of a full raise does not
  reopen betting to players who have already acted.
- A street ends when everyone in the hand has acted and matched the high
  bet, or is all in.
- Pots: each all-in amount caps a side pot. Each pot goes to the best hand
  among its eligible players; ties split, and odd chips go to the first
  eligible seat left of the button.
- Runout: when at most one player in the hand can still bet, the remaining
  streets deal on their own with pauses, and every hand in it is face up.
- Show or muck: a player who wins with everyone else folded has a few
  seconds to Show; otherwise the cards go unseen.
- Bust: a player with no chips after a hand leaves the table. Several busting
  in one hand are placed by their stacks at the start of that hand, larger
  first; equal stacks share the place.
- End: one player has every chip. Places run from 1 (winner) up.

### Clocks

All timing counts world ticks (`STEP_MS` 50), so a stopped match leaves no
timer behind.

- Shot clock: `shotSec` per action. Expiry auto-checks if checking is free,
  otherwise auto-folds. A disconnected player's clock is 2 seconds.
- Level clock: runs only while a hand is being played or between hands, and
  stops when the match stops.
- Pacing beats (tunables): deal, flop/turn/river reveal pauses, runout
  pauses, showdown, show-or-muck window, fold linger. All live beside
  `STEP_MS` in the poker definition.

### Options

`MINIGAME_OPTIONS.poker`:

| Key | Label | Default | Min | Max |
| --- | --- | --- | --- | --- |
| `stack` | Starting stack | 1500 | 100 | 100000 |
| `bigBlind` | Starting big blind | 20 | 2 | 10000 |
| `levelMin` | Minutes per level | 10 | 1 | 60 |
| `shotSec` | Shot clock seconds | 30 | 5 | 120 |

## Architecture

```
server/minigames/poker/
  cards.ts        deck, seeded shuffle (existing shuffle.ts), card codes
  evaluate.ts     best 5 of 7: rank, tiebreak, hand name, the five cards
  pots.ts         side pots from contributions; award with odd-chip rule
  equity.ts       win % for hands in a runout
  table.ts        the world: seats, streets, legality, clocks, bust order
  definition.ts   MinigameDefinition<PokerWorld>: frames, inputs, checkpoint
client/
  PokerBoard.tsx, PokerPlayer.tsx
  poker.ts        pokerCues(prev, next, role), gesture classifier
```

Each engine file is pure and seeded. `definition.ts` is the only file that
knows about the runtime.

### Inputs

All discrete, acknowledged, with a server-domain `at`:

- `fold` with an optional `flick: { dx, dy, speed }`, clamped to a unit
  direction and speed 0–1. No flick means a plain fold (the button fallback).
- `check`, `call`, `raise { to }`, `allIn`.
- `show`, only during the show-or-muck window.
- `react { kind }`: one of `nice`, `ouch`, `bluff`, `wow`. Any participant,
  busted included, one per 3 seconds. Extras are refused `too-soon`.

`apply` refuses anything that is not legal right now: out of turn, a
check that isn't free, a raise under the minimum or over the stack.

### Frames

`boardFrame` (everyone at the table sees this; spectators get it too):

- seats: player, stack, street bet, markers (button, small blind, big blind,
  folded, all in, busted, disconnected), and cards only when face up
- community cards, pots, current actor, shot clock `actBy` as server time
- level, big blind, next level at (server time), hand number
- `equity` per seat during a runout
- `showdown`: winners per pot, hand names, winning five cards
- `feed`: the last ~20 actions, each with a rising `id`, seat, kind, amount,
  and a fold's flick. Clients key animations on `id`, so a reconnect does not
  replay history.
- `discard`: how many cards are in the pile this hand

`playerFrame` adds the player's own hole cards, the legal actions with
call amount and min/max raise, and the show-or-muck flag. Nobody else's
hole cards are in any frame until they are face up.

### Checkpoint and resume

Two optional hooks join `MinigameDefinition`:

```ts
/** A small durable summary; changes only when a new one should be saved. */
checkpoint?(world: W): { version: number; data: unknown } | null
/** Rebuilds a world from a saved checkpoint instead of `create`. */
resume?(data: unknown, options: Record<string, number>): { world: W; participants: PlayerId[] }
```

- Poker's checkpoint is taken as each hand begins, before blinds: seats with
  stacks, button, level and elapsed level ticks, bust order, hand number, and
  the seed state for the next shuffle.
- After each pump the runtime compares the checkpoint version with the one
  stored in `state.minigame.checkpoint`. A newer one is stored and reported
  with `onState('minigame:checkpoint')`, which persists it.
- `snapshot.ts` already keeps every other `state.minigame` field when it
  resets a playing match to ready, so the checkpoint rides through a restart
  with no new branch. `MinigameState` gains `checkpoint?: { version; data }`.
- On Start, a session with a checkpoint calls `resume`; participants are the
  checkpoint's seats and busted players, connected or not. Anyone who joined
  since watches. `prepareMinigame` makes a fresh session, which is how the
  host starts a new tournament instead.
- The host's Stop (`cancelMinigame`) returns to ready with the checkpoint
  intact, so Stop then Start is the pause: the current hand is voided.
- Other minigames implement neither hook and behave as today.
- Undo leaves the table alone; there is no per-hand undo.

### Results

`MinigameResult` gains an optional `place`. Poker returns every participant
with `points: 0`, `shots: 0` and a place. The hub's existing commit adds
nothing to the scores.

## Board

A felt oval with up to 10 seats. Each seat shows the name in the player's
identity colour, stack, street bet and markers. The middle holds the
community cards, the pots, and the discard pile beside the deck. A top strip
shows the blinds, time to next level, and hand number. A narrow action feed
runs down one side in the style of the Sketch chat ("Mia raises to 120").

## Phone: a small felt table

```
┌────────────────────────┐
│  ↑ flick here to fold   │  top zone, felt
│                         │
│      ┌───┐ ┌───┐        │
│      │ ▓ │ │ ▓ │        │  hole cards, face down; press to peek
│      └───┘ └───┘        │
│                         │
│  double tap to call 120 │  bottom zone: "check" or "call N"
│   [ Raise ]  [ All in ] │
└────────────────────────┘
```

- **Fold: flick the cards up.** The cards follow the finger. Released with
  enough upward speed and travel, they fly off the top and the fold is sent
  with the flick. Short of that, they spring back.
- **Check or call: double tap** anywhere on the felt. The bottom text always
  says which, with the amount.
- **Peek: press the cards.** They turn over while pressed, whether or not the
  finger moves. Peeking then flicking folds.
- **Raise and All in** stay buttons. Raise opens a sheet with a slider,
  presets for ½ pot, pot and all in, and a confirm.
- **Not your turn:** the zone texts dim to "Mia to act". A flick springs back
  with `fx-shake`; a double tap does nothing.
- **Busted:** a spectator view of the table with the reaction row.
- The reaction row (Nice hand, Ouch, Bluff?, Wow) sits under the actions.
- The gesture classifier is one pure function from a pointer trace to `tap`,
  `doubleTap`, `flick` or `press`, with thresholds as tunables (flick speed,
  flick travel, double-tap gap, tap slop, press delay) so they can be tuned on
  a real phone.

## Interactions and feedback

Built from the interest kit (design.md §4). Win % and clock numbers are
measurements: cyan readouts, no effects.

| Moment | Board | Phone |
| --- | --- | --- |
| Deal | each hole card `fx-drop`s to its seat | own cards `fx-drop` |
| Flop, turn, river | cards `fx-flip` one at a time, a beat before turn and river | — |
| Your turn | seat `fx-glow-pulse` | turn cue, vibrate where supported |
| Shot clock | ring on the seat; last 5 s `fx-heartbeat` | ring; last 5 s `fx-heartbeat` and tick cue |
| Flick fold | cards fly from the seat to the centre along the flick, linger face down, then float to the discard pile | cards fly off the top |
| Auto-fold | cards slide slowly to the centre, linger, float to the pile | `fx-shake`, "Auto-folded" |
| Check | seat `fx-squash` knuckle rap, "Check" chip, two-knock cue | — |
| Call, bet, raise | chips `fx-slide--charge` to the pot, pot `<CountUp>`, stack `fx-flash--tint` | stack `fx-flash--tint` |
| All in | "All in" stamp `fx-zoom` on the seat, cue | — |
| Runout | hands in it flip face up; streets deal slowly with a drumroll; win % per seat after each card | own win % |
| Showdown | winning five lift, others dim, hand name in `<Letters>`, winner `fx-tada` + `<Burst>`, pot slides to them | "You win 840" or the winning hand |
| Show | the shown cards `fx-flip` on the seat | — |
| Reaction | the word floats up from the sender's seat | — |
| Bust | seat `fx-poof`, "Out in 5th" `fx-rubber-stamp` | "Out in 5th" |
| Level up | banner `fx-zoom` "Blinds 50 / 100", cue | — |
| Winner | name `fx-hero-slam-glow`, confetti | — |

Equity: exact enumeration from the flop on; preflop uses 5 000 seeded
samples. It is computed once per revealed card, not per frame.

### Cues

`pokerCues(prev, next, role)` in `client/poker.ts` compares two frames of the
same match and returns the cues for that surface, the same shape as
`sketchCues`. Room cues play on the board only: deal, flop, turn, river,
check knock, chips, all in, runout drumroll, win, bust, level up. Personal cues
play on the owning phone only: your turn, clock tick, auto-fold. Each joins the
`Cue` union with a placeholder recipe in `client/cues.ts`, swapped for real
sounds later through the cue workbench; existing tuned sounds are untouched.

## Host

The Games tab lists Poker with its options. The panel shows hand number,
blinds, time to next level and seats left, and "Resume from hand N" on Start
when a checkpoint exists. Stop voids the hand in play; Close ends the
tournament. Starting a new tournament is preparing Poker again.

## Testing

Pure, seeded, per AGENTS.md; no UI tests.

- `evaluate`: every category, kickers, wheel straight, board plays, ties.
- `pots`: three all-ins of different sizes, a folded contributor, odd chips.
- `table`: min-raise, a short all-in does not reopen betting, heads-up
  blinds and order, the shot clock checks or folds, level changes at the next
  hand, multiple busts in one hand get places, a stale-turn input is refused.
- Checkpoint then resume reproduces stacks, button, level and next shuffle.
- `pokerCues`: each moment gives its cue on the right surface, once.
- The gesture classifier over synthetic traces, near each threshold.
- `npm run sim-poker`: bots play a tournament to one winner against a
  disposable room; total chips are constant after every hand.

## Left out

Free-text table chat, hand history on the phone, rebuys, antes, multiple
tables. Each can come later without changing the shapes above.
