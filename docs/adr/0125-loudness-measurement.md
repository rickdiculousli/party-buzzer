# How the loudness check measures and rescales cues

- A cue's level is its loudest 100 ms K-weighted window in LUFS, not BS.1770's 400 ms, because most cues are shorter than 400 ms and a longer window averages silence in. Rendering mimics WebAudio closely enough to rank and level cues to about a dB: naive oscillators and filter coefficients updated per 128-sample block, like WebAudio's k-rate path. It is not a mastering meter.
- WebAudio's biquad Q is in dB for lowpass/highpass and linear for bandpass; the coefficient formulas follow that.
- Noise differs per play, so a level is the median over a fixed set of seeds; fixed, so a cue near a tier edge cannot flip between runs. `SLACK` (1.5 dB) sits above the roughly ±0.5 dB render variance.
- The tiers are set by hand-tuned anchors (`award`/`penalty` hero, `stamp` signal, `type` foley), which are exempt and never rescaled, as is `poker-puft`, tuned by ear on the phone. A cue that should be quieter on a phone is played there with `gain`, not given a second recipe.
- `--apply` rewrites only one-line recipes in `client/cues.ts`, keeping them one line; multi-line recipes (the anchors) are left alone.

Where: `tools/loudness.ts` (`TIERS`, `STANDARD`, `SLACK`, `coefficients`, `level`, `measure`)
