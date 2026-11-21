# A miss is marked by `award.penalty`, never by the sign of `points`

Whether a verdict was a miss is `award.penalty`, read with `isPenalty`, because the host's "Wrong, no penalty" costs zero and `-0` does not survive JSON: reading the sign would turn a free miss into a payoff of zero and show the room a reward for missing. Every miss stamps `penalty: true`, zero-cost ones included, and a genuine payoff of zero is still a payoff. The legality table's `already-scored` and the host desk's judging gate read the flag for the same reason, so a retake stays judgeable under the penalty its rebound keeps up.

Where: `shared/protocol.ts` (`Award`, `isPenalty`), `server/state.ts` (`wrong`), `server/modes/quizbowl.ts` (`onWrong`), `shared/legality.ts` (`refuses`), `client/Host.tsx` (`QuizDesk`)
