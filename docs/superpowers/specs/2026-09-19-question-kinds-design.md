# Question kinds: shown and choice

Any pack can mix three kinds of question in one list. The kind belongs to the
question, not the mode or the setlist block. Quizbowl still requires `read`
questions to be useful, but nothing stops a quizbowl block from containing the
others.

| Kind | On the board | Voice | Answering |
| --- | --- | --- | --- |
| `read` (default) | Revealed clause by clause as spoken | Reads the question | Buzz, spoken or host-judged answer |
| `shown` | Whole question at arm | Reads the question | Buzz, spoken or host-judged answer |
| `choice` | Whole question at arm; choices after it is read | Reads the question, then the options | Every eligible phone picks one option |

## Pack format

```
K: shown                             optional; read when absent
Which planet has the most moons?
A: Saturn

V: 200
C: Mars | Venus | Saturn | Jupiter   any C: line makes it a choice question
Which planet has the most moons?
A: Saturn                            must equal one choice
```

- `Question` gains `kind: 'read' | 'shown' | 'choice'` and `choices?: string[]`.
- `K:` accepts `read` or `shown`. `K: choice` without `C:` is an error; a `C:`
  line with `K: shown` is an error.
- A choice question needs 2 to 6 choices, and its `A:` first variant must equal
  one of them (case-insensitive). The parser records the correct index.
  Extra `A:` variants are ignored for choice questions.
- The parser reports these through the existing `errors` list and skips the
  question.

## Reader

`Reader.run`'s per-question body splits into functions in `server/reader.ts`.
The arm, dwell, reveal and next scaffolding stays shared.

- `speakQuestion(q, sig, { revealAll })`: today's aligned or per-fragment
  playback. With `revealAll`, every fragment is published at the arm (after
  `whole`), so the board shows the full text. `fragmentEnded` still follows the
  voice, so quizbowl power works for `shown`.
- `read` and `shown` then use today's buzz and verdict wait.
- `runChoice(q, sig)`:
  1. Dispatch `arm`. The judge is not primed.
  2. `speakQuestion(q, sig, { revealAll: true })`.
  3. Publish `choices` (options only). Picking opens.
  4. Speak the options clip ("A, Mars. B, Venus. ..."). When it ends, publish
     `closesAt = now + choiceSec`. The countdown starts here.
  5. Wait until every eligible player has picked, `closesAt` passes, or the
     host sends `closeChoice`.
  6. Dispatch `{ a: 'settleChoice', correct }`, then the existing dwell and
     `next`. The resolved check for a choice question is `round.correct !== undefined`.
- Synthesis renders one extra options clip per choice question. `textsFor`
  includes it so `waitFor` gates on it.
- The correct index stays in Reader memory until `settleChoice`, like accepted
  answers today.

## State

New `Round` fields, all cleared on arm:

| Field | Set by | Host / board | Phone |
| --- | --- | --- | --- |
| `kind?: 'shown' \| 'choice'` | `arm` from the reader (absent = read) | yes | yes |
| `choices?: string[]` | reader act `choices` | yes | yes, regardless of mirror |
| `closesAt?: number` | reader act `closesAt` | yes | yes |
| `picks?: Record<PlayerId, number>` | player act `pick` | full | own entry only |
| `correct?: number` | `settleChoice` | yes | yes |

- For `shown` and `choice`, phones receive `fragments` regardless of the mirror
  setting, because the board already shows the whole text. `whole` stays
  host/board-only as today.
- `round` is already in the undo snapshot and reset on disk load; the new
  fields ride that. Undo of `settleChoice` restores the picking state with the
  reader stopped (as undo does today); the host clears it with Next.
- New setting `choiceSec` (default 20, 5 to 120) beside `answerWindowSec`, set
  through a new `setChoiceTime` host action, persisted like `answerWindowSec`.

## Picking and scoring

- `pick` is a player act, routed like `useItem`: accepted only when
  `round.kind === 'choice'`, `choices` is set, `correct` is not, the deadline
  has not passed, the player has not picked, and the player is in `buzzable`
  when that is set. Frozen or locked-out players cannot pick.
- A buzz on a choice question is refused by `buzzBlockReason`.
- Eligible players for "everyone has picked" are connected players who pass
  the pick checks.
- `settleChoice` is a `HostAction`. Legality: only on a choice question with
  choices up and no `correct` yet. It adds `round.value` to `scoreKey(player)`
  for each correct pick (so a team gains once per correct member), sets
  `correct`, and moves the phase to `IDLE`. It does not set `round.award` and
  does not call the mode's `onCorrect`/`onWrong`. Wrong picks cost nothing.
- Host gets a "Close" control while picking, sending the host-scoped act
  `closeChoice` to the reader.

## Wall and phone

The board keeps its three bands.

- **Above**: empty until reveal; then a stamp reusing `board__award` styling:
  "+200 · 5 right", or "Nobody". No answer lane: the grid shows the answer.
- **Mid**: the existing `clue` occupant with the whole text shown. No hero
  appears during a choice question.
- **Below**: new `Wall.choices: { options, correct?, tally?, winners?, in, of, closesAt? } | null`,
  co-occurring with the other bands like `timeline`. A 2×2 grid (3×2 for five
  or six), option text clamped to two lines, "6 of 9 in" and the countdown
  under it. On reveal the correct cell gets an interest-kit fx, the others dim
  and show their counts, and the winners' names appear as chips.

New moment family `choice`, ranked above `verdict` when `round.kind === 'choice'`:

| Moment | When | Phone |
| --- | --- | --- |
| `choice:listening` | armed, no `choices` | "Listen", no buzzer |
| `choice:picking` | `choices` set, no `correct` | Option buttons, then "Locked: Saturn" |
| `choice:reveal` | `correct` set | "Right +200" or "Wrong: Saturn" |

`momentOf` uses only public fields (`kind`, `choices`, `correct`, `closesAt`).
The tally and winners come from `picks`, which only host and board have; the
phone uses its own pick.

`idle:ready` and the next-question card are unchanged once `next` clears the
round.

## Tests

- `shared/pack.test.ts`: `K:` values, `C:` parsing, the `A:` match, choice
  count limits, error cases.
- `server/actions.test.ts`: `settleChoice` scoring (solo, teams, nobody right),
  its legality, undo.
- Hub tests: `pick` legality (twice, late, not buzzable, frozen, not a choice
  question), buzz refused on a choice question, `viewFor` redaction of `picks`
  and fragments visible for shown/choice without the mirror.
- `server/reader.test.ts` with fake speech: `shown` publishes all fragments at
  arm and still reports `fragmentEnded` per fragment; `choice` publishes
  choices after the question clip and `closesAt` after the options clip, then
  settles on all-picked, on timeout, and on `closeChoice`.
- `shared/wall.test.ts`: the three choice moments, and `choices` on the wall.
- Review workbench scenarios for `choice:picking` and `choice:reveal` on board
  and phone.

## Docs

- `shared/pack.ts` header: `K:` and `C:`.
- `README.md` pack format section.
- `docs/question-styles/`: a short guide for choice questions (plausible
  distractors, one unambiguous answer).
- `ARCHTECTURE.md`: question kinds in the Reader section.
- `docs/design.md`: the choice grid and the `choice` moments.

## Out of scope

- Speed bonus, team majority, penalties for wrong picks.
- Choice questions without a pack (the host has no way to enter choices).
- Changing an already locked pick.
