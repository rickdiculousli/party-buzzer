# Answer audio is buffered from lock-in and sent as mono WAV

- The recorder's worklet runs from the moment the player locks in, so an answer spoken as the finger lands keeps its first syllable; pointerdown only marks a position and pointerup cuts from the mark to now. The buffer is a ring of about ten seconds, so a lock-in the host stalls on never grows memory for the whole stall. The worklet source is an inline blob URL, which needs no build plumbing or extra asset.
- Browsers record in different codecs (Safari's MediaRecorder gives AAC, Chrome Opus-in-WebM, which stock macOS cannot decode), so the phone encodes raw samples to mono 16-bit PCM WAV itself. The server's recogniser reads WAV directly, and the header carries the real sample rate, so there is no resampling step.

Where: `client/recorder.ts` (`Recorder`), `client/wav.ts` (`encodeWav`), `client/Talk.tsx` (`Talk`)
