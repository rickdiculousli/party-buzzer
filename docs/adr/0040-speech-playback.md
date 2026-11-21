# Speech is pre-rendered to cached files and stopped by killing the player

`say` synthesises at about realtime, so live synthesis would put a pause before every sentence. Every line is rendered up front to a file cached by a hash of voice and text, which makes playback cheap to start and cheap to abandon, and so makes the reader's pause instant.

- Renders go to a temp path and are renamed into place on success; a `say` killed mid-render never leaves a truncated clip under the real path, and the atomic rename also settles two concurrent renders of the same text.
- A failed render returns duration 0: nothing plays and the fragment still goes up on the board. Without the macOS binaries the whole game runs silently.
- `Playback.started` resolves when sound is actually coming out: the Swift player prints one line to stdout once playback begins, and the reader times the board's reveal from it. `started` is always released, including when stopped before spawning and when a clip never announced itself, or a caller would wait forever.
- With no seeking player and an offset requested, `afplay` plays from the start: wrong but audible, where silence would look like the reader had died.
- Stop is `SIGKILL`, never `SIGSTOP`: a frozen `afplay` cannot refill CoreAudio's ring buffer and the device loops the last fraction of a second several times. Pause therefore kills the clip and the reader replays (or seeks to the last fold) on resume.

Where: `server/speech.ts` (`render`, `play`, `playerBinary`), `server/play/play.swift`, `server/reader.ts` (`pause`)
