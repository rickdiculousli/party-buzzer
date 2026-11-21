# Anchor cues stay hand-tuned WAVs, wrapped in no-op file layers

The anchor cues (`stamp`, `leader`, `award`, `penalty`) are hand-tuned WAVs. They sit in `RECIPES` as `{ file }` layers so the layer editor and the loudness standard can see them, but the wrapper must not change a sample of what plays: full level from the first sample, `level: 1`, a `sustain` equal to the file's length so the gate never closes early, and a release past the buffer's end, which `client/cues.test.ts` asserts. New sound systems wrap these files rather than replace them, and the loudness check treats the anchors as the fixed points that set the tiers, never rescaled.

Where: `client/cues.ts` (`RECIPES`), `client/cues.test.ts`, `tools/loudness.ts` (`TIERS`)
