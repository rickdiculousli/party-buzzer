# The moment ladder's order is the behaviour

`momentOf` returns the first moment that matches, so its order is load-bearing: reordering within a family is safe, reordering across families changes behaviour. `shared/wall.test.ts` pins these placements:

- `arrival` ranks first and covers whatever the idle round still holds (a payoff, a choice reveal). `choice` and `closest` come next: those questions have no leader, transcript or verdict, so no later moment applies to them.
- `answer:judging` outranks every verdict: a spoken miss publishes the transcript, award and `held` in one broadcast, and the room must read what was said (until `Local.settled`) before how it scored.
- `verdict:hold` sits above `answer:locked` because a hold keeps the phase LOCKED; the other way round it could never be reached.
- A verdict outranks the duel's next nomination window: a penalty rides the rebound it caused, so the phase is already ARMED underneath it.
- Any buzz (COLLECTING) ends a verdict even inside its dwell: the board sounds the buzz-in on that broadcast, so the new name must be up on that frame, not the last player's minus score.
- A penalty outlives its dwell while a duel's rebound is open to one player (only the other seat buzzing takes it down), and always under a scoreless mode, so the miss stays up until someone buzzes; ARMED is public, so phones agree. With no award at all in a duel (an undo, a module that stamps none) the face-off stays up rather than a bare "Ready".
- While the box is reading (`readingActive` and ARMED), the question resuming ends the verdict beat, outranking both the dwell and the rebound hold: the board's `--penalty-dwell` counts from the transcript finishing and cannot agree with `autoplay.reboundSec`, and the voice must not resume under a stamp. A room without the box keeps the dwell.
- A payoff ends the question: the winner stays the hero through `nextSec`, and a clue still up does not take the stage back. A penalty does not end the question.
- `verdict:unanswered` is IDLE with a question up and no award, which only `timeUp` produces.
- `duel:dead` is `buzzable` being `[]` (both seated players missed). Absent means everyone may buzz; never collapse the two.
- `buzz:collecting` outranks `duel:faceoff`: a press says who *is* answering, the pair only who *may*.
- `idle:finale` sits below every verdict, so the last payoff is read first; it lasts until the host clears or loads another setlist.
- Welcome ends at the first arm, for good, rather than returning between questions (the bed would swell back every question). It is keyed on `armedAt` and the scores, never the buzz count, which phones do not receive.

Where: `shared/wall.ts` (`momentOf`, `Moment`), `shared/wall.test.ts`
