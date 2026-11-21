# ElevenLabs takes: the voice is the opt-in, and each take is paid once

A take costs credits, so it renders once ever, cached by a hash of voice and script, and the voice rather than the API key is the opt-in: a key in the shell must not be enough to start spending (`--eleven` takes the house voice, `ELEVENLABS_VOICE_ID` another). Each take carries a timestamp per character, which places its folds in place of transcription. The character-times `.json` is written before the `.mp3`, and the mp3 temp-and-rename, because the mp3's existence is what marks a take cached and it must never exist without its times. A failed take falls back to `say` with the audio tags stripped, since `say` would read them aloud.

Where: `server/eleven.ts` (`synthesize`, `folds`), `server/index.ts` (`startServer`), `tools/voice.ts`
