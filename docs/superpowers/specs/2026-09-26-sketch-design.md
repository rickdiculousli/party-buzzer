# Sketch — design

A skribbl-style drawing race as a fourth minigame. One player draws a word on
their phone, the drawing appears live on the board, and everyone else types
guesses. Faster correct guesses score more.

## Why

The quiz is person-to-system and rewards the two players who know things; Bow
and Tank are mechanics toys. The room wants a race everyone is in on every
turn, where the laughs come for free from bad drawings and wrong guesses. The
crowd tolerates a short typed guess but not composing text, and does not want to
dwell on each other's creations. Sketch has to work as a short setlist block and
as a 15-minute main event with one design.

## Rules

### A turn

1. **Choose (10 s).** The drawer's phone offers three random words from the
   list; on timeout the first one is taken. The board shows "<name> is
   choosing".
2. **Draw (Draw seconds, default 80).** The drawer draws on a canvas with
   **Undo** (last stroke), **Clear**, and **Pass**. No colours or brush sizes.
   Strokes stream live to the board.
3. **Guess.** Each guesser's phone shows the blanks (letters as `_`, spaces and
   punctuation shown as-is) and one text field with Send.
   - A wrong guess goes up on the board's guess feed under the guesser's name.
   - A close guess (edit distance 1 after normalizing) is not shown on the
     board; only that guesser's phone shows "Close!".
   - A correct guess is never shown on the board. That phone switches to its
     place and time ("Got it · 2nd · +0.41s") and shows the word; it sends no
     more guesses this turn.
   - Hints: one unrevealed letter at half the draw time and another at three
     quarters, chosen by the world's seeded random. Words of three letters or
     fewer get no hints.
4. **Reveal (5 s).** The turn ends when every guesser has it, when the draw
   time runs out, or when the drawer passes. The board shows the word and who
   got it, in order, with times. Then the next drawer's choose step starts.

The match ends after the last drawer's reveal.

### Guess matching

Normalize both the guess and the word: lowercase, strip everything but letters,
digits, and spaces, collapse runs of spaces, trim. Correct is equality after
normalizing. Close is a Levenshtein distance of exactly 1 on the normalized
strings, and only for words of four or more normalized characters.

Guesses are discrete inputs, so they carry the runtime's clamped server-domain
`at` and fire in order. The order of correct guesses and each time since the
draw started come from `at`. A guess that reaches the world outside the draw step
is refused.

### Scoring

- A guesser scores `50 + round(50 × remaining / drawTime)` for a correct guess,
  where `remaining` is the draw time left at the guess's `at`.
- The drawer scores `round(100 × correct / guessers)`, where `guessers` counts
  the match's participants other than the drawer. A pass still pays for guesses
  already made.
- `results()` returns each participant's total; the runtime adds these to the
  standings as it does for Bow and Tank. `shots` is 0.

### Drawers

Draw order is the participants shuffled with the match seed. The **Drawers**
option limits the number of turns; 0 means everyone once. The match needs at
least two connected players.

A drawer who disconnects is not detected: their choose step times out onto the
first word and their draw step runs out. **Pass** covers words that can't be
drawn. Disconnect awareness in the runtime is a separate change if this proves
annoying.

Late joiners spectate until the next match (existing runtime behaviour).

### Words

`packs/sketch-words.txt`, committed: one word or short phrase per line, blank
lines and `#` lines ignored, duplicates dropped. A starter list of a few hundred
party-safe drawable words ships with it. `prepare()` refuses when the file is
missing or has fewer than 3 × the number of turns words. Words already offered
this match are not offered again.

### Not in scope

Colours, brush sizes, difficulty tiers, chat between players who have guessed,
disconnect skipping, and twist rounds (head-to-head drawers, sabotage).

## Architecture

A new folder `server/minigames/sketch/`, built like Ink. No runtime changes.

| File | Owns |
| --- | --- |
| `words.ts` | Loading and parsing the word list |
| `world.ts` | Pure rules: create, apply, step, turn clock, matching, hints, scoring, results |
| `definition.ts` | `MinigameDefinition`: classify, frames, stroke resend throttle |
| `world.test.ts` | Logic tests (below) |

- Untimed definition with 50 ms steps; the turn clock counts in ticks and
  `finished` is true after the last reveal.
- Inputs: `ink` (live points, continuous); `pickWord`, `stroke`, `undo`,
  `clear`, `pass`, `guess` (discrete). Only the drawer may draw or pick, and only
  in their step; only non-drawers who have not yet guessed right may guess.
- `validPoints` moves from `ink/world.ts` to a place both games import
  (`shared/protocol.ts` beside `quantizePoint`). Committed strokes use Ink's
  version-plus-periodic resend throttle so the board recovers a dropped frame.

### Frames

- **Board:** step (`choosing` / `drawing` / `reveal`), drawer, turn number and
  total, strokes and live points, blanks with revealed hints, the draw deadline
  in server time, the last ~8 wrong guesses (name and text), and the correct
  guessers (name, order, seconds). The word only in `reveal`.
- **Drawer's phone:** the three choices while choosing, then the word, the
  strokes, and an op counter like Ink's `inkOps` so the phone can reconcile its
  own strokes.
- **Guesser's phone:** the board's shared view without the word, plus its own
  `close` flag for its last guess and its own place and time once correct. The
  word appears on a guesser's phone only after that guesser is correct or in
  `reveal`.

### Protocol and client

- `MinigameId` gains `'sketch'`. `MINIGAME_OPTIONS.sketch`:
  `drawSec` (Draw seconds, 80, 30–180) and `drawers` (Drawers, 0, 0–30;
  0 = everyone). Sketch frame types join `MinigameFrame`.
- A refusal for fewer than two connected players, via `startable`.
- `client/SketchBoard.tsx` and `client/SketchPlayer.tsx`; one row in
  `MINIGAME_INFO` (`Sketch`, `timed: false`, `picksTeams: false`) and in
  `client/minigames.tsx`. Stroke rendering reuses `strokePath` from
  `client/ink.ts`. Use design tokens and existing components; the guess feed is
  drama (warm), the guess times are measurement (cyan).

## Testing

`world.test.ts` covers:

- normalizing, correct and close matching (including the four-character floor);
- order of correct guesses by `at`, and guesser scores from remaining time;
- the turn ending on all-guessed, on timeout, and on pass, and the drawer's score
  in each;
- a guess outside the draw step, or from the drawer, or repeated after a correct
  one, is refused;
- the hint schedule and the no-hint floor;
- choose timeout taking the first word; no word offered twice in a match;
- the match finishing after the Drawers limit.

`npm run sim-sketch` plays bot drawers (scribbles) and guessers (wrong, close,
and correct guesses at uneven speeds) against the running server, like
`sim-ink`, so a full room can be watched without twelve phones.

UI and glue get no tests, per AGENTS.md; check them with the sim and real phones.

## Docs

- README: a Sketch section under the minigames.
- ARCHTECTURE: add sketch to the minigame runtime row.
- `docs/design.md` §9: **guess** is a typed answer in Sketch or Ink, distinct
  from a pick and a buzz; **drawer** is the player drawing this turn.
