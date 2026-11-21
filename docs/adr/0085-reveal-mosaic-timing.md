# Picture-reveal mosaic timing and drawing

- The last cell count aims at what a room can see on the wall, not the canvas resolution; past about a hundred cells steps look the same and the last quarter would be a still picture with the bonus still on offer.
- Cell counts are fractional so every step changes the grid; the grid is centred and the small canvas gets a stretched underdraw so edge part-cells are opaque and neither edge crawls as the count grows.
- `revealShownAt` returns undefined while a press is not yet published, and the component keeps the last instant shown.
- A live picture goes whole only `REVEAL_WHOLE_GRACE_MS` after `until`: the board learns of a press a network trip later, and a press just before the end would otherwise show the whole picture for a beat and then pull back. The price still drops on time; the grace end gets its own render.
- Renders are timed by a timeout aimed just past each step boundary, not a free-running interval, so the stakes chip drops when the price does.
- Decoded images are cached by URL and drawn in a layout effect, so the picture that unmounts while the hero takes the middle comes back on the rebound in the same frame, never blank.
- The stakes chip flashes only on a fall; a rise is a late press correcting the price, not news.

Where: `client/reveal.ts` (`REVEAL_LAST_CELLS`, `revealShownAt`, `revealDrawnAt`, `revealCells`), `client/RevealPicture.tsx` (`RevealPicture`, `useShownAt`, `RevealStakes`)
