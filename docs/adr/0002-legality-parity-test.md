# The legality table and the server are held to parity by a sweep

`shared/legality.ts` only helps if `applyHostAction` obeys it. The costly failure is quiet: the table allows an action, the host's button is live, and the server does nothing. `server/state.test.ts` applies every host action in a spread of rooms and asserts both directions: allowed means the state changes, refused means it does not.

- Actions are listed by hand, not derived from the `HostAction` type, so a new action has to be added deliberately. Every argument differs from what the rooms hold, because idempotent setters legitimately do nothing when given the current value.
- `openDuel` uses `host-pick`, not an instant rule whose outcome depends on the draw; an unknown rule is the single bad-argument case.
- The inert-but-legal list is limited to deleting something absent, plus `undo` (the hub owns the snapshot stack, so `applyHostAction`'s `undo` is empty by design). Anything else landing there is the drift the test exists to catch.
- Rooms are chosen to reach each rule: the idle room has played a question (an empty room is legitimately inert for `next`/`resetRound`); a scored room pins `already-scored`; a seated duel mid-question exercises `closeDuel` refusing for being seated before the phase; a setlist room is the only one where setlist actions are live.
- Every room carries both the `games` and `duelRules` catalogs, because the table treats an empty catalog as no opinion and the check would pass vacuously.

Where: `server/state.test.ts` (`ROOMS`, `room`, `ACTIONS`, `inertlyLegal`), `shared/legality.ts` (`refuses`)
