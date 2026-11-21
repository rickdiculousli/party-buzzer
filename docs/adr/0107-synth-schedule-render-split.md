# Synthesis splits into pure scheduling and a WebAudio walker

`schedule` turns a recipe into plain steps (seconds, values, curves) and runs in Node; `render` only walks those steps on WebAudio and decides nothing, so every rule worth testing lives in `schedule` and the tests need no browser. Rules on the scheduling side:

- Every exponential step, its target and its starting value (oscillator glides and filter sweeps) is floored at `GAIN_FLOOR` (-80 dB), because `exponentialRampToValueAtTime` throws on zero and a decay to silence or a dial at `freq: 0` is ordinary.
- A layer's stop is its segments summed in milliseconds and converted once; converting each segment and adding drifts in float64.
- `render`'s stop handle swallows a second `stop()`, which some engines throw on, because cutting a preview that already finished is normal.

Where: `client/synth.ts` (`schedule`, `render`, `GAIN_FLOOR`), `client/synth.test.ts`
