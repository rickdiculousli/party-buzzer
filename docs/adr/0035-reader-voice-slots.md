# Question audio and asides play in separate slots

The reader keeps two playbacks. `playback` is the question being read, and `onStateChange` stops it whenever the round leaves `ARMED`, because a reader who keeps talking over a buzz gives away the rest of the clue. `quipback` holds asides (verdict quips, the next-question cue, block introductions); these play over the payoff, where a state change must not cut them, but stop and pause do.

- `voiceEpoch` rises on stop, pause and begin, so an announcement that finishes rendering after one of those is dropped rather than played late.
- `S:` scripts, `R:` reactions and quips are used only with a performing voice (`ReaderOpts.perform`): `say` would read the audio tags aloud.

Where: `server/reader.ts` (`Reader.playback`, `quipback`, `voiceEpoch`, `onStateChange`, `quip`, `announce`, `cue`, `ReaderOpts.perform`)
