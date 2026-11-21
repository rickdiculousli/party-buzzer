# Next advances the setlist only past a played question

- `next` captures whether a question was actually played (`round.armedAt > 0`) before resetting, and advances the setlist only then. That separates a finished question from a double-tap on Next or a stale award being cleared.
- `resetRound` is the host taking a question back and never spends a setlist question.
- `advanceSetlist` runs after the reset, because a block's `openDuel` needs an idle round and a cleared duel to land on.
- A duel is one question: `next` and `resetRound` delete it; the host reopens it, or rematches by arming before Next.

Where: `server/state.ts` (`mutateHostAction` cases `next`, `resetRound`), `server/setlist.ts` (`advanceSetlist`)
