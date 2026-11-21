# Transcription is an on-device Swift helper, built on demand

Speech-to-text is a small Swift program compiled by `swiftc` at boot (rebuilt when its source is newer), the same machine-binary posture as `say`, `afplay` and `ffmpeg`, never an npm dependency, and recognition is on-device because the party WiFi has no route to the internet. Without the source or the compiler every call returns null and spoken judging stays off. Boot transcribes one throwaway clip so the first real answer does not pay the model load. macOS kills the helper when the app that launched the server lacks speech-recognition permission (T3 Code does), and every answer would then score as silence, so the server logs the helper's stderr and a hint to start from Terminal, whose permission the helper borrows.

Where: `server/stt.ts` (`sttBinary`, `transcribe`), `server/stt/stt.swift`, `server/index.ts` (`startServer`)
