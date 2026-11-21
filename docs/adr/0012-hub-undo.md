# Undo: deep history, restored in place, published once

Undo exists because awarding points to the wrong player, often noticed a question later, is the mistake a host actually makes and is otherwise unrecoverable; both steps must come back in order. A snapshot is a few KB, so `UNDO_DEPTH` is generous.

Undo restores game data into the same `State` object so subscribers keep their reference. Stopping the reader and minigame publishes runtime updates, so those frames are suppressed (`restoring`) while the restore runs and subscribers see exactly one complete restored game. `stopReaderQuietly` uses the same suppression where dispatch stops the reader and publishes once itself.

Where: `server/hub.ts` (`UNDO_DEPTH`, `undo`, `stopReaderQuietly`, `changed`), `server/integration.test.ts`
