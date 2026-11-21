# The State field lifetime table and its codes

`server/lifetimes.test.ts` holds one row per `State` field; a new field fails the test by name until it has a row, and changing a row is the deliberate lifetime decision AGENTS.md asks for. The codes:

- undo `yes`: in `gameSnapshot`, so undo returns it; `live`: left out, and the current value survives an undo (catalogs); `no`: left out, and undo clears or resets it (playback).
- disk `yes`: written by `persistedSnapshot` unchanged; `reset`: written narrowed or rewound (round value only, a reset match); `no`: not written, rebuilt or forgotten on restart.
- phone `full`: a player's `viewFor` carries what the host's does; `own`: a player-specific projection; `none`: never sent to a player.

A row describes the test's fixture. Some fields vary by shape (a lobby `arrival` is dropped from undo; a `minigame` in ready or results is written to disk unchanged; `typed` is `none` only because the fixture's mirror is off), and `snapshot.test.ts` and `hub.test.ts` cover those cases.

Where: `server/lifetimes.test.ts` (`lifetimes`), `server/snapshot.ts`, `server/hub.ts` (`viewFor`)
