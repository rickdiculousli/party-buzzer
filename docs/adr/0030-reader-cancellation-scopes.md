# The reader's waits are scoped by abort signals, not flags

Every await in the read loop takes an `AbortSignal` and throws when it fires, so a stopped, replaced or undone question can never wake up and write into a live round. The protection lives at the `await`, not in a flag check each caller has to remember.

- `session` is a fresh `AbortController` per read session: `stop()` aborts it and `begin()` replaces it, because an aborted controller never un-aborts. `run()` captures its own session at the top, since Stop then Read replaces `this.session` while the old loop unwinds.
- Each question's scope is `AbortSignal.any([session, watch(mine && stillMine)])`, built only after the arm, because `stillMine` compares against the `questionId` that arm minted. An abort is how a question normally ends, so the loop's catch swallows `AbortError` quietly.
- `mine` is cleared in the loop's `finally` and followed by `wake()`; without it a question that ended well would leave its watcher in `waiters` for the rest of the session.
- `watch` rides the same `waiters` set as `until`, so a predicate over hub state is re-checked exactly when hub state changes and there is no second notification path.
- Once the verdict is in, the waits switch to the session's scope: `next` clears `round.questionId`, which falsifies `stillMine`, so a question-scoped payoff wait would abort on the very keypress that releases it. `waitOutBuzz` likewise checks the session after the miss quip, because a host's Next during the quip legitimately ends the question.
- A refused `arm` (an introduction arrived during the next-question card) ends the session like an abort: autoplay and the pack position stay as they are.
- `ensure` re-checks the signal after rendering, since rendering takes minutes and ignores the reader.
- Pause is not an abort: `speak`/`speakWhole` hold on `until(!paused)` and re-read; `resume()`'s `publish` is what wakes them.
- Fold-reveal timers check both the question signal and `stillMine`, and are cleared before `throwIfAborted`, so no timer reveals into a dead session or someone else's round.
- Every exit from `until` goes through one `done` that removes the waiter and clears the dwell timer (a stale waiter would re-run all session; a live timer holds the process open past Ctrl-C).
- `sleep` (the next-question card and the count to `armedAt`) takes the signal too and is deliberately not `unref`'d: both are short, and a half-armed question is worse than a two-second exit delay.
- `begin()` publishes the active state before the loop starts and only `stop()` clears `state.reading`, so the two publications cannot race.

Where: `server/reader.ts` (`Reader.run`, `begin`, `stop`, `watch`, `until`, `waitOutBuzz`, `speakWhole`, `speak`, `ensure`, `sleep`)
