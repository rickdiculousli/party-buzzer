# A lobby yields to play; an introduction holds it

The two arrival kinds behave oppositely. A block introduction holds play until the host continues: `arrivalBlocksPlay` is true only for it, and `refuses` answers `introduction-active` to `arm`, `prepareMinigame` and `openLobby`. A practice lobby never refuses play: `endLobby` removes it when real play starts (an arm, an accepted read, a duel or minigame launch, and `prepareMinigame`). `closeArrival` for an introduction removes only `state.arrival`; it starts no question, block, read, seat or match by itself (the hub folds any block start into the dismissal).

Any applied action that raises a new introduction stops the reader quietly, as `prepareMinigame` does, so a reader mid-dwell or mid-preparation cannot arm a question over it.

Where: `shared/arrival.ts` (`arrivalBlocksPlay`, `endLobby`), `shared/legality.ts` (`refuses`), `server/state.ts` (`mutateHostAction` cases `arm`, `openDuel`, `closeArrival`), `server/hub.ts` (`dispatch`, `introRaised`, `stopReaderQuietly`)
