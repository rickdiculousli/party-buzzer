# The legality table says what the host may press; surfaces keep hints and payload checks

`refuses` in `shared/legality.ts` answers one question: may the host send this action in this room. It rules on the round, not on the action's payload. Anything else a host control needs stays in the surface that shows it, and is not a second rules ladder:

- Hints about what pressing would achieve stay local. Closing a duel window that would seat nobody is legal (the server takes it without complaint), so `closeBlockReason` advises rather than refuses. It also needs `eligibleForDuel` and `willSeat` from `client/ui.ts`, which `shared/` may not import.
- Checks on a form's own contents stay local: the two hand-picked duel players and their same-team test, and the "is there a block after this one" bound on Skip block. Whether the room permits the action at all goes through `refuses`.
- Both ways of closing a duel (resolve the pool, or name two) are the same `closeDuel`, so one refusal governs both buttons.
- When a refusal decides which control is in a slot, not only whether it is greyed, it is still asked of the table. Reopen replaces Correct only when `refuses(state, { a: 'rebound' })` allows it, even though `round.held` says the same today, so a refused `rebound` can never put a live dead button in front of the host.

Where: `client/DuelPanel.tsx` (`closeBlockReason`, `DuelPanel`), `client/Host.tsx` (`QuizDesk`), `shared/legality.ts` (`refuses`)
