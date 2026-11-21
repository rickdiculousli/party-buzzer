# The minigame runtime owns lifecycle; definitions are pure game rules behind a fixed hook contract

`MinigameDefinition` is everything the runtime needs from one minigame. The runtime owns lifecycle, clocks, input queueing, input dispositions and acks; a definition never schedules or acknowledges anything itself. The hook rules a new minigame must follow:

- `create` receives the room (`MinigameRoom`: roster in join order, grouping, teams, standings) as a read-only view at Start; a definition reads it and never keeps a reference.
- `prepare` is checked on prepare and again on start, so a definition may load files there (Ink's cards, Sketch's words) and rely on them in `create`.
- `classify` decides an input's lifetime: `discrete` inputs carry a server-domain `at`, are checked against the match window, fire once and are acknowledged; `continuous` inputs are applied in arrival order with no ack; `null` drops a malformed input.
- `afterFrame` runs after each broadcast so per-frame accumulators (cover deltas, blasts, pad versions) reset there and nowhere else.
- `hostStatus` returns `until` in world milliseconds; the runtime maps it to server time with the `Clock`.
- Starting a match clears the lobby's Ready list, so a match cancelled back to ready asks everyone for a fresh Ready.

Where: `server/minigames/definition.ts` (`MinigameDefinition`, `MinigameRoom`), `server/minigames/runtime.ts` (start path)
