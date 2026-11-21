# One buzz collection window, ordered by press time

After the first eligible buzz the Hub collects for the whole `collectMs` (one second) and orders by clamped press stamp, not arrival, so a slow phone carrying an early stamp still takes the lead after a faster packet has been shown in front. The provisional reveal at `revealMs` (150 ms) is for responsiveness, not a cut-off: a 150 ms window left the board showing one mark almost every question (docs/design.md, "Seeing it move"). Judging waits for the lock, because scoring mid-window would strand buzzes still in flight, so legality refuses a verdict before `LOCKED`.

Where: `server/hub.ts` (`REVEAL_MS`, `buzz`, `reveal`, `settle`), `server/resolve.ts` (`resolveBuzzes`), `shared/legality.ts` (`refuses`)
