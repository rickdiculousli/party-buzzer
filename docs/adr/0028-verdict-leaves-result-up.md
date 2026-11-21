# A verdict leaves its result on the wall until the room moves on

The room has to read a verdict, so the transitions that end a question or an attempt leave what it produced in place until something new replaces it.

- `correct` keeps `round.order` and the spoken transcript (`round.spoken`) up beside `round.award`; only `arm` and `next` clear them. Clearing the order at the verdict would vanish the result at the moment the room looks at it.
- `wrong` clears the old award before calling the mode's `onWrong`, because a module owns its own penalty the way it owns its payoff; the penalty award it stamps stays up through the rebound until the next arm or a correct. The default `wrong` stamps a penalty award even when the penalty is zero: without one the wall shows a bare "Ready" through the rebound.
- `timeUp` keeps the question (its answer is what the room reads next) and only stops buzzing.
- After a spoken miss, `round.spoken` is what tells the room why the question is still open. Under a held rebound the transcript is the hold and comes down with it in the `rebound` action, because the clue resumes in that instant and would otherwise be read under the red line. During the hold the judge reopens no window and nobody may buzz.
- With no hold (autoplay off, or a host judging by hand) `wrong` re-arms through `openRebound` in the same tick the judge published the transcript, so `openRebound` does not clear it; it stays until the first press of the rebound, when it would otherwise sit above the new leader's name.

Where: `server/state.ts` (`mutateHostAction` cases `correct`, `wrong`, `timeUp`, `rebound`; `openRebound`), `server/hub.ts` (`buzz`), `server/judge.ts` (`onStateChange`)
