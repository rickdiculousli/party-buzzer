# One buzz collection window, ordered by press time

After the first eligible buzz the Hub collects for the whole `collectMs` window and orders by clamped press stamp, not arrival. The provisional reveal at `revealMs` is for responsiveness only: it is not a cut-off, later buzzes keep joining the published order, and a late packet carrying an earlier stamp still takes the lead. Judging is refused until the window locks, since scoring early would strand buzzes still in flight.

- Arming is scheduled ahead, so `ARMED` includes a countdown. A buzz is dropped when its server arrival time is before `armedAt`; arrival is server truth, so this needs no clock tolerance.
- Locked-out presses (and duel non-seated, frozen or mode-blocked ones) are rejected before they enter `pending`, so they can never open or close a window on a round they cannot lead.
- Every buzz after the reveal republishes the order. Before the reveal the published order is still empty, so broadcasting leaks nothing about the field.
- A steal on a picture reveal keeps the thief's own press stamp (or the room's first) instead of the arm instant, because the stamp is also the price and where the picture holds; snapping to the arm would turn a sharp picture back into the mosaic.
- `resolveBuzzes` rounds `deltaMs`, a number people read, because the fractional part of a `performance.now()` stamp is precision the clock sync cannot back up; ordering uses the full-precision clamped stamp.

Where: `server/hub.ts` (`REVEAL_MS`, `buzz`, `publish`, `reveal`, `settle`), `server/resolve.ts` (`resolveBuzzes`), `server/integration.test.ts`
