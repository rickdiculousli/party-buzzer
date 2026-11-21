# When the host desk may judge

`QuizDesk` computes `judgeable`, which gates Correct, Wrong, Space, Shift and W:

- Judging waits for `LOCKED` even though the leader shows during collection. Scoring mid-collection would strand buzzes still in flight; the server enforces the same rule.
- It also needs a leader: a lock with an empty order is reachable when a freeze lands mid-window, and there is nothing to judge.
- "Scored" means a non-penalty award (`!!round.award && !isPenalty(round.award)`), not any award. A penalty stays up through the rebound it caused (`openRebound` leaves it so the wall keeps saying why the question is open), and the retake must stay judgeable over it. `isPenalty` is used rather than the sign because "Wrong, no penalty" stamps zero points.
- `scored` is computed locally rather than as `refuses(state, { a: 'correct' }) === 'already-scored'`, because the table answers `no-leader` first everywhere except `LOCKED` with a leader. `notesFor` reads the same fact; in `answer:locked` a null judge note means the buttons are live, while elsewhere null means nothing to add.

Where: `client/Host.tsx` (`QuizDesk`, `notesFor`), `shared/protocol.ts` (`isPenalty`)
