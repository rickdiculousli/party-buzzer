# Cue rate is one resampling knob, at play time and when baked

A cue's `rate` resamples: it multiplies every frequency and divides every time, as `playbackRate` does for a buffer, so 2x is an octave up and half as long, and file layers resample with the oscillators beside them. Separate speed and pitch were rejected because they need time-stretching, a phase vocoder and a dependency; a cue that needs one without the other bakes it into its file with ffmpeg. Adoption bakes a dialled rate with `asetrate` plus `aresample`, not `atempo`, so the file matches what was heard. A layer's `head` (buffer seconds) and the bed's `cut` (output time) stay outside the rate.

Where: `client/synth.ts` (`schedule`, `render`), `client/sound.ts` (`play`), `tools/sndlib.ts` (`ffmpegArgs`)
