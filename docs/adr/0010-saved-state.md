# Saved state: coalesced writes, and any snapshot boots

- `saveState` schedules one write on the first change; later changes only replace the queued snapshot, so a burst costs one write and a game that keeps changing still saves within the delay (a throttle, not a debounce that resets). `flushSave` writes synchronously so shutdown never waits on a timer.
- `loadState` must start from any file a past build or a hand edit left, so it defaults rather than rejects. Missing or malformed fields (mode memory, items, effects, a minigame lobby's `ready`, autoplay dwells) are filled from defaults and re-clamped.
- A game id this build does not register falls back to trivia; setlist blocks naming unknown games or duel rules are dropped, and a setlist left empty is removed, rather than booting into one that misbehaves at block 3.
- A duel and `round.buzzable` never survive a restart: the pool was voted under a room that may not be back, and without the duel `buzzable` is two ids that can buzz for a reason nobody can see.
- The reader is never mid-pack on boot (`readingActive` false, `reading` removed), because the Reader instance is new; a stale running flag would offer Pause on a reader that never started and run the next Read paused.

Where: `server/state.ts` (`saveState`, `flushSave`, `write`, `loadState`)
