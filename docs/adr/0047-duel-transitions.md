# What survives around a duel

- An unseated duel (a pool still being gathered) is dropped by `setMode` and `setGrouping`, because the pool was built under the old game or grouping. A seated pair is a commitment and survives both.
- `openDuel` seats immediately only for a rule with no entry gate that resolves at random; every entry rule waits for the host to close it, including `volunteer-random`, which needs its volunteer window before there is anyone to draw from. An instant rule with fewer than two eligible players opens nothing.

Where: `server/state.ts` (`mutateHostAction` cases `setMode`, `setGrouping`, `openDuel`), `server/duel.ts` (`resolveDuel`)
