# ElevenLabs takes: paid once, timed per character, opt-in by voice

ElevenLabs renders each script as one take with a timestamp on every character; those timestamps place the reader's folds so the board reveals each clause as the voice begins it. A take costs credits, so it renders once ever, cached by a hash of voice and script.

- The voice is the opt-in, not the API key: a key in the shell must not be enough to start spending. `--eleven` opts in with the house voice and `ELEVENLABS_VOICE_ID` picks another.
- The character-times `.json` is written before the `.mp3`, and the mp3 is written temp-and-rename, because the mp3's existence is what marks the take cached; it must never exist without its times.
- A failed take falls back to `say`, with audio tags stripped first (they are directions, not words, and `say` would read them aloud); that clip has no character times, so it falls back to the speech-recognition fold.
- A performed script may add tags, ad-libs and stretched words. Tags are blanked before matching, doubled letters collapse on both sides (a stretched "Reeed" matches "Red"), and a phrase is found by its words in order, preferring a hit whose next word also matches so an ad-lib's "and" does not take the source's "and".
- A fold fires at the first word of the clause it reveals, not the word at its end. A clause whose first word is not found gets no fold, so the next fold reveals it late rather than early.

Where: `server/eleven.ts` (`synthesize`, `tokens`, `match`, `folds`), `server/index.ts` (`startServer`, the `speech` and `align` wiring)
