# Choice and closest questions never give an answer away early

- The board lists who has picked or guessed, never which option or number, until the reveal: the board is in front of the room and a number up early is one the next phone copies. These walls are built from `picks` and `guesses`, which only the host and board receive; phones never call `wallOf`.
- `pickers` and `guessers` are ordered by `round.picks` / `round.guesses` key insertion order, which is the order the room answered in; anyone still out follows.
- `allPicked` and `allGuessed` are false when nobody is eligible, not vacuously true, so a question in an empty room waits for its deadline instead of settling at once. Both count the same `pickers`, so the board's "6 of 9 in" and the reader's wait agree.
- Closest distances are rounded to six decimal places before comparison, so guesses the room sees as equally far (1.1 and 0.9 around 1) tie and share the pot instead of being split by floating-point error.
- A closest guess's place (1 took the value, 2 took half) is by distance from the truth, not by points paid: a three-way tie for the value can pay each less than second place's half.

Where: `shared/wall.ts` (`choiceWall`, `closestWall`), `shared/choice.ts` (`allPicked`, `pickers`), `shared/closest.ts` (`allGuessed`), `shared/scoring.ts` (`closestOff`, `closestAwards`)
