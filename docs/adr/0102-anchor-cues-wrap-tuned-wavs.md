# Anchor cues wrap the hand-tuned WAVs in no-op file layers

A cue in `RECIPES` is rendered by `synth.ts`; any other cue falls through to the sample path in `sound.ts`. The anchor cues (`stamp`, `leader`, `award`, `penalty`) are hand-tuned WAVs wrapped in `{ file }` layers, which gives them the waveform editor without changing a sample of what plays. The wrapper must stay a no-op: no attack or decay so gain is full from the first sample, `level: 1` (an omitted level means `GAIN_FLOOR`, near silence), `sustain` equal to the file's length in ms so the gate never closes early, and a 40 ms release that runs past the buffer's end. Re-cutting a file means updating its `sustain`.

- `leader` is one cue with two layers, the drop and the buzzer under it, both starting at 0, because they are one moment and one cue puts them on one timeline. A `delay` on either would reorder a moment the room knows by ear.
- Volume is the layer's `gain`, never a stylesheet property, so a cue's sound is described in one place.
- `addLayer` gives a new file layer `level: 1` and a sustain of the decoded file's length, since a file layer with no segments is silent; `Layers.add` decodes before adding so that length is known.
- `cues.test.ts` asserts each anchor layer plays its file at a flat level for its whole length and outlives it.

Where: `client/cues.ts` (`RECIPES`, `addLayer`), `client/cues.test.ts` (`FILE_LAYERS`, `LEVEL`), `client/anim/Layers.tsx` (`add`)
