# A miss is marked by `award.penalty`, never by the sign of `points`

`round.award` is stamped on every verdict and outlives the button press so the wall can show the result; a wrong answer's stamp rides the rebound it causes. Whether it was a miss is the `penalty` flag, because the host's "Wrong, no penalty" costs zero: `-0` does not survive JSON (`JSON.stringify(-0)` is `"0"`), so reading the sign would turn that miss into a payoff of zero and the room would be shown a reward for missing. A genuine payoff of zero (a question worth nothing) is still a payoff. Read it with `isPenalty`, and stamp `penalty: true` on every miss, zero-cost ones included; moving the stamp inside an `if (penalty)` would hide a free miss from the room.

In quizbowl's `onWrong`, a host's `neg: 0` (the "no penalty" button) always means no penalty; any other value the host sent is replaced by the module's configured `neg`.

Where: `shared/protocol.ts` (`Award`, `Round.award`, `isPenalty`), `server/state.ts` (`wrong`), `server/modes/quizbowl.ts` (`onWrong`), `server/modes/buzzer.ts`, `shared/wall.ts`
