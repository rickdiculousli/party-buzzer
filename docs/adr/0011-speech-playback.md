# Speech is pre-rendered to cached files and stopped by killing the player

macOS `say` synthesises at about realtime, so live synthesis would put a pause before every sentence; every line is rendered up front to a file cached by a hash of voice and text (a temp path renamed into place), which makes playback cheap to start and cheap to abandon. Stop and pause are `SIGKILL`, never `SIGSTOP`: a frozen `afplay` cannot refill CoreAudio's ring buffer and the device loops the last fraction of a second. So pause kills the clip and resume replays it, or seeks to the last fold with the Swift player. The reveal is timed from `Playback.started`, the player's line on stdout once sound comes out, not from the spawn.

Where: `server/speech.ts` (`render`, `play`, `playerBinary`), `server/play/play.swift`, `server/reader.ts` (`pause`)
