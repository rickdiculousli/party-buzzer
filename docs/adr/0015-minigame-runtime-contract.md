# The minigame runtime owns lifecycle; definitions are pure rules behind a fixed hook contract

`MinigameDefinition` is everything the runtime needs from a minigame. The runtime owns lifecycle, clocks, input queueing, dispositions and acks, and a definition never schedules or acknowledges anything, which lets every game share one fixed-step pump, frame path and checkpoint mechanism and be tested as plain functions. `classify` decides an input's lifetime: `discrete` inputs carry a server-domain `at`, are checked against the match window, fire once and are acknowledged; `continuous` ones (aim, Tug taps) apply in arrival order without acks; `null` drops a malformed one. `create` gets a read-only `MinigameRoom` at Start and keeps no reference to it.

Where: `server/minigames/definition.ts` (`MinigameDefinition`, `MinigameRoom`), `server/minigames/runtime.ts`
