# Player identity across reconnects and repeated hellos

- A reconnect can land before the old socket's close, so a player is marked away only when the last connection carrying their id leaves.
- A second `hello` on a live socket without a `playerId` falls back to the connection's existing player and renames it rather than minting a duplicate. A returning phone auto-greets and then greets again when tapped to play.

Where: `server/hub.ts` (`remove`, `join`), `server/integration.test.ts`
