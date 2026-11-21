# Answer audio is buffered from lock-in and sent as mono WAV

Browsers record in different codecs (Safari's MediaRecorder gives AAC, Chrome Opus-in-WebM, which stock macOS cannot decode), so the phone encodes raw samples to mono 16-bit PCM WAV itself; the recogniser reads it directly and the header carries the real sample rate, so nothing resamples. The recorder's worklet runs from the moment the player locks in, so an answer spoken as the finger lands keeps its first syllable: a press marks a position in a ring of about ten seconds and the release cuts from the mark.

Where: `client/recorder.ts` (`Recorder`), `client/wav.ts` (`encodeWav`), `client/Talk.tsx` (`Talk`), `server/index.ts` (`startServer`, `POST /spoken`)
