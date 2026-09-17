# Phantom Ink minigame design

A digital pad for Phantom Ink (a game the owner bought), played as a
minigame: phones write freehand ink, the board is the pad. Card text is
transcribed from the owner's own cards into a gitignored local file.

## Names

Plain names replace the rulebook's themed ones. Canon words (design.md §9)
already own "question", "answer", "round" and "hold", so identifiers avoid
them.

| Rulebook | UI label | Identifier |
| --- | --- | --- |
| Medium | Guesser | `guesser` |
| Spirit | Writer | `writer` |
| Object | Secret word | `secret` |
| Question card | Prompt | `prompt` |
| Object card | Word card | `wordCard` |
| Ask a Question | Ask | `ask` |
| Guess the Object | Guess | `guess` |
| Silencio | Stop | `stop` |
| Knock / finger to lips | Correct letter / Wrong letter | `judge` |
| Eye space | Peek row | `peek` |
| Clue | Clue | `clue` |
| Pad | Pad | `pad` |

Minigame id `ink`, display name "Phantom Ink".

## Rules as implemented

- Two teams, Sun and Moon. Each has one Writer and one or more Guessers.
  Guessers on a team share one hand of prompts.
- Setup: each team's hand is 7 prompts. Both Writers see one random word card
  (6 numbered words) and agree on the secret word.
- Sun takes the first turn; turns alternate. Each team's pad side has 8 rows;
  a team's turn uses its next empty row.
- Peek rows: Sun rows 4, 6, 7; Moon rows 3, 5, 6 (1-based). When a team's turn
  starts on a peek row, its Guessers pick any unfinished clue row on the pad
  (either team). That row's Writer adds exactly one letter, taps Done, and the
  turn continues normally. Finished clues (ended with a period) and guess rows
  cannot be picked. If no row qualifies, the peek is skipped.
- Ask: Guessers pick 2 prompts from the hand and send them. The Writer keeps
  1 and discards the other face up (public). The Writer writes a clue in the
  team's row. The clue ends when:
  - a Guesser taps Stop: the Writer may finish the letter in progress, then
    taps Done; or
  - the Writer taps End clue, which appends a period (the word is complete).
  The kept prompt joins the team's asked list, visible only to that team (the
  physical card lies face down in front of its Medium). The team draws 2
  prompts.
- Guess: a Guesser writes one letter in the team's row and taps Check. The
  Writer taps Correct letter or Wrong letter. Wrong strikes through the strokes
  since the last check and ends the turn. After the final letter a Guesser
  taps Finish guess (appends a period); the Writer taps Win or Not it. Not it
  ends the turn with no other penalty.
- Redraw: once per game per team, the Guessers may discard the hand face up
  and draw 7.
- End: a team wins on Win. If all 16 rows fill without a win, both teams lose.
  Results give each member of the winning team 1 point.
- Deck exhaustion: when the prompt deck runs out, the discard pile is shuffled
  back in.
- Clue content rules (letters and spaces only, no form of the secret word) are
  table talk, not enforced; ink is never recognized.

## Ink

- Freehand on a canvas with the row's aspect ratio; strokes are point lists in
  row-normalized coordinates (0..1 each axis), quantized to 3 decimals.
- Undo last stroke removes only the most recent stroke, once. After an undo,
  earlier strokes are locked; a new stroke becomes undoable. Writer and guess
  canvases share this rule.
- Stop does not lock the canvas immediately; Done does. After Stop the Writer
  phone shows "Finish your letter".
- A strike is stored as a range of stroke indexes and drawn as a line through
  their bounding box.
- The pad row keeps each segment's author and kind (clue, peek letter, guess
  letter) so the board can render them.

## Lobby (ready phase)

- Phones and board show two columns, Sun and Moon, listing members with
  `n/cap`, cap = ceil(connected players / 2). Overfilled counts render in the
  danger tint (e.g. `6/5`). Volunteers show a marker.
- Phone buttons: Join Sun, Join Moon, Volunteer to write (toggle, only after
  joining a team).
- Start is refused with `unpicked` while any connected player has no team, and
  with `team-too-small` while either team has fewer than 2 members.
- On Start, each team's Writer is a random volunteer, or a random member if
  none volunteered. Everyone else is a Guesser. Cancel returns to ready with
  the lobby intact; Start re-rolls Writers.

## Voting and touches

- Every Guesser team choice is a vote: Ask vs Guess, which 2 prompts, which
  peek row, redraw. Each option has a Vote button; each Guesser's vote shows
  as a pip in their player colour beside the option. Prompt votes pick a set
  of up to 2.
- A vote applies when every Guesser on the team has the same choice (for
  prompts, the same set of 2). A single Guesser's vote applies immediately.
  Any Guesser can press Force for 2 s to apply the leading choice (ties: the
  earliest-reached). Force is refused with no votes cast.
- Writer choices (keep one prompt, secret word) are not votes. Secret word:
  either Writer picks, the other confirms or picks differently; it locks when
  both Writers have picked the same word.
- Guess canvas: the first Guesser to draw holds the canvas until Check. Any
  Guesser can tap Stop during a clue.
- Touches: tapping a card or pad row away from its buttons sends an ephemeral
  touch `{ target, x, y }` (target-relative 0..1). Recipients render a ring
  labelled with the player's name at that spot, fading over ~600 ms, like
  screen-recording touch indicators. Touches are relayed, never stored, never
  undone. Hand-card touches go to teammates only; pad-row touches go to
  teammates and the board.

## Visibility

| Viewer | Sees |
| --- | --- |
| Board | Lobby, pad ink, turn and step, prompt discard pile, peek rows, pad touches. Never the secret word or hands. |
| Writer | Secret word, the 2 offered prompts, own team's asked prompts, pad, own canvas, judge buttons when needed. Not the other team's hand. |
| Guesser | Own team's hand, votes, touches; own team's asked prompts; pad; guess canvas; Stop. Never the secret word. |
| Other team | Pad and discard pile only; not your hand, votes, asked prompts or touches. |

Word card: during choosing, both Writers see it; Guessers see "Writers are
choosing".

## Runtime changes

- `MinigameDefinition` gains optional:
  - `untimed?: true` — runtime ignores `durationSec`/`endsAt` and never
    completes on time.
  - `finished?(world): boolean` — checked after each step; true completes the
    match with `results(world)`.
  - `startable?(lobby, connected): refusal reason | null`.
  - `touchAudience?(world, playerId, target): { players: PlayerId[]; board: boolean }`.
- `create` receives the lobby.
- `MinigameState.lobby?: { teams: Record<PlayerId, 'sun' | 'moon'>; volunteers: PlayerId[] }`,
  in projected state (all roles). Kept across cancel; cleared on close.
- New client messages: `minigameLobby` (`join` team, `leave`, `volunteer` on/off;
  only in ready phase; refused otherwise) and `minigameTouch`.
- New server message: `minigameTouch` with the player name.
- Board frames always carry the in-progress strokes; the full pad only when
  `padVersion` changed since that client's last frame, plus once a second.
- Bow and tank behavior is unchanged.
- Limitation: the world is not saved. A server restart or undo mid-game sends
  the match back to ready and the game is lost.

## Card file

`packs/phantom-ink.txt`, gitignored:

```text
P: What is it made of?
P: Where would you find it?
W: Apple | Calendar | Snowman | Chili | Fox | Table
```

`P:` is a prompt, `W:` a word card of exactly 6 words. Prepare refuses with a
host-visible reason when the file is missing or has fewer than 16 prompts or
no word cards.

## Files

- `server/minigames/ink/types.ts`, `world.ts` (pure rules), `cards.ts`
  (parse), `definition.ts`; registry entry.
- `shared/protocol.ts`: `ink` id, `InkInput`, ink frames, lobby and touch
  messages.
- `client/InkBoard.tsx`, `client/InkPlayer.tsx`, `client/ink-canvas.ts`
  (stroke capture and drawing), a shared lobby component; `minigames.tsx`
  entries.
- `server/hub.ts`: route lobby and touch messages.
- README section; ARCHTECTURE.md minigame row.

## Testing

- `world.test.ts`: turn cycle, Stop then Done ordering, End clue period,
  single-stroke undo lock, votes (unanimous, Force, single Guesser), peek rows
  and skip, guess judging and strike, Win, 16-row loss, deck reshuffle, redraw
  once.
- `cards.test.ts`: parse and refusal cases.
- Runtime test: untimed completion through `finished`, `startable` refusals,
  lobby messages only in ready, Writer selection.
- View/relay test: board never gets the secret word or hands; the other team
  never gets your hand, votes or touches.
- Self-play walkthrough script, like the tank one.
