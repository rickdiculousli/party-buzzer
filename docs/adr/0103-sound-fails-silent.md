# Browser sound loads lazily and fails silent

- A missing sound is never an exception: `play` before the context is unlocked or before a buffer has decoded does nothing, and `render` skips a file layer with nothing decoded. A thrown error on the wall the room is watching costs more than one missed cue.
- When a file layer is skipped, `playRecipe` starts its decode so the next trigger has it: one silent cue, not a silent night.
- Sample files are fetched and decoded on first use, not on page load, so a phone never downloads the long welcome bed it will not play.
- `prime` takes cue names and primes the right store for each: a recipe cue's `{ file }` layers go into the file map `render` reads (priming the sample buffer instead would leave the cue silent), a sample cue gets its own buffer.
- `render` returns a stop handle only for the harness's previews; board cues always run to their end.

Where: `client/sound.ts` (`play`, `playRecipe`, `load`, `prime`), `client/synth.ts` (`render`)
