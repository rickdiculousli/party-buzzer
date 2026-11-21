# Room defaults and autoplay dwells

- `newState` writes the default game as a trivia literal (no options, empty module memory) so building a state never touches the mode registry, which may not be loaded yet.
- Autoplay is off by default: a host who has not asked for it must never find the room moving on without them.
- The rebound dwell (`autoplay.reboundSec`, default 4 s) is long enough for the board to finish the miss: the transcript types out and holds, the penalty stamps and dwells, and only then does the clue resume. At 2 s the voice comes back while the penalty is still landing.
- `setAutoplay` clamps every dwell on the server (`secs`: tenths of a second, 0 to 60, with a fallback), not at the input: a number field can send NaN, and a NaN dwell is a reader that never wakes up.

Where: `server/state.ts` (`newState`, `secs`, `mutateHostAction` `setAutoplay` case)
