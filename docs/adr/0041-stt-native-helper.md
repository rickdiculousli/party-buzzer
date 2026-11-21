# Transcription is a native Swift helper, built on demand and warmed at boot

- Speech-to-text is a small Swift program compiled by `swiftc` at server boot (rebuilt when the source is newer), the same machine-binary posture as `say`, `afplay` and `ffmpeg`, never an npm dependency. Without the source or the compiler every call returns null and spoken judging stays off, as speech degrades to silence.
- Recognition is on-device, because party WiFi has no route to the internet.
- The first transcription pays the model load (seconds cold, about 180 ms warm), so with real speech-to-text available boot transcribes one throwaway clip, which caches like any other. A failed warm-up is ignored: the first real answer just pays the load.
- The helper writes why an answer came back empty to stderr (for example "Siri and Dictation are disabled", a settings switch rather than a quiet player), and the server logs it.
- macOS kills the helper (a signal, distinct from the exit 1 of hearing nothing) when the app that launched the server lacks speech-recognition permission, as T3 Code does; every answer then scores as silence. The server logs a hint to start from Terminal, whose permission the helper borrows.

Where: `server/stt.ts` (`sttBinary`, `transcribe`), `server/stt/stt.swift`, `server/index.ts` (`startServer`)
