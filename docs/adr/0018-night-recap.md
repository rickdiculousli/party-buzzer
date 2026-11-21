# Night recap rules and the keepsake file

`shared/recap.ts` derives milestones and finale cards from the night's ledger. It is pure (facts in, words out, no clock or DOM), so the board, the `/recap` page and the keepsake file all read the night the same way.

- Only positive or neutral facts become cards: no slowest, most wrong or fewest points. A recap that embarrasses a guest is not a keepsake.
- Rank is competition rank (how many keys score strictly more), so an all-zero opening ranks everyone first and roster order alone never makes anyone last.
- A streak counts consecutive questions a key got right; a question answered by someone else, or nobody, ends it, while minigame, item and standings facts between questions do not touch it.
- A comeback needs a field of four or more and is a key reaching the podium (`min(3, floor(n/2))`, so the top two in a field of four) from the bottom half, once per key. The milestone names the rank at the climb; the card names the best rank held from then on, which is where the night ended for them.
- Milestone priority at a question or match: first correct, then new leader, then comeback, then streak. The first correct answer also makes its scorer the first outright leader, so it outranks that.
- No "Closest finish" card when nobody scored, which is also what a scoreless mode looks like.
- The keepsake is one file per night, named for the local date of the night's first fact, so a party running past midnight keeps one file. A cleared night (no facts) writes nothing, so clearing after the finale cannot blank the file it wrote. `flushNights` writes synchronously, so shutdown does not wait on a timer.

Where: `shared/recap.ts` (`recapCards`, `milestones`, `milestoneFor`, `RANK`, `rankOf`, `runSteps`, `comebacks`), `server/nights.ts` (`nightDate`, `saveNight`, `flushNights`)
