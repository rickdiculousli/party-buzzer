# Cue rate is one resampling knob

A cue's `rate` (and the harness's slow motion through `rateScale`) resamples: it multiplies every frequency and divides every time, exactly as `playbackRate` does for a buffer, so 2x is an octave up and half as long. File layers resample with the oscillators beside them. Separate speed and pitch control was rejected because it needs time-stretching (a phase vocoder and a dependency); a cue that needs one without the other bakes it into the file with ffmpeg (`atempo` for length, `asetrate` for pitch).

Two values deliberately stay outside the rate: a layer's `head` is an offset into the buffer in buffer seconds, and the bed's `cut` is wall-clock output time, so each means the same thing whatever the rate.

Where: `client/synth.ts` (`schedule`, `render`), `client/sound.ts` (`play`)
