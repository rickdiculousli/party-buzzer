# Probe parks the room on an exact moment, through the game's own paths

Probe runs a script of steps once, left to right, and exits, leaving the board on the last frame: the screen is server state, so nothing needs holding up. It drives the game only as a host and phones would, so a step exercises the real rule rather than routing around it.

- `join` borrows a player of that name already in the room (a fake or a phone) rather than duplicating them; otherwise it mints a stable `probe-` id. Only probe-minted players are ever kicked.
- `clear` (and Ctrl-C) undoes exactly what this run did: stop the reader first (it would re-arm over the cleanup), then `next` before `clearSetlist` (which is refused unless IDLE), unassign before kicking (an assign for a gone player does nothing), zero teams' scores (a team's score outlives its players), and `clearNight` last so the actions above do not write standings into a cleared ledger. Teams grouping, setlist, reader, autoplay and minigame are undone only if probe turned them on.
- `arm` waits for the real ARMED; `buzz` offsets are from the real `armedAt`, and each press is sent at its instant (an early packet is dropped by the hub, and real-time presses land on the board one by one). The buzz step then waits for LOCKED, counted from now rather than from `armedAt` (a `wait:` between arm and buzz would put the sum in the past), with `last + COLLECT_MS + ARM_DELAY_MS` only as a ceiling for presses that all get dropped.
- `pick` and `guess` offsets count from when the choices or guessing open, not the arm: the room cannot answer what it cannot read yet.
- `read` fails fast if the reader does not start (no pack selected or the block names none); `armed` then waits minutes, since a setlist renders every pack from cold on a first run. `speak`/`say` wait for this player's judge window and fail within ten seconds if the judge is off; `say` renders its clip before waiting, so the first run does not spend the answer window on `say`.
- `say` renders answers with macOS `say` in a voice of its own (`SAY_VOICE`, default Samantha, falling back to the default voice), cached beside the reader's clips as WAV, since the extension sets `say`'s container and the judge writes what it receives to a `.wav` path.
- Steps split on the first colon only, since setlist duel rules and act data contain colons. In a setlist step a pack name holds no colon and a rule id no `@`, so the suffixes are unambiguous.
- `mode` pins the mode so walkthrough scores repeat; `direct` is the one step that touches a setlist probe did not set, because a direct-play script cannot run in setlist mode. A fresh setlist's introduction is closed as a host pressing Continue would.
- `teams` turns the grouping on only if it is off (`setGrouping` drops an open duel) and reuses a team of the same name.
- Duel entry and vote acts go from each player's own socket (the hub drops `duel*` acts from a connection with no player); withdrawing a vote is voting again for the same name, as a phone does; votes are spaced 250 ms so the tally visibly counts.
- When pacing a `loop` script to sit on the open buzzer, push buzz offsets out rather than adding a `wait` after `arm`: the deltas are relative to first place, and a `wait` would let every packet arrive in one tick.

Where: `tools/probe.ts` (`main`, `clear`, `idFor`, `sayClip`)
