# The e2e harness relies on the server's message ordering

`FakeClient` in `server/e2e.ts` waits on ordering guarantees the Hub provides rather than on timers, so changing that ordering in the Hub silently breaks the integration tests.

- A player's `welcome` is sent before the join broadcast, so the first new state after `hello` means both have landed.
- The Hub broadcasts state before it replies with `actionResult`, so `request()` can read the outcome from `last`.
- A `pong` follows every frame sent to that socket before it, so one ping round trip (`flush`) drains the socket.
- The end of the arm delay is never broadcast; `untilOpen` waits for the broadcast `armedAt` on the shared process clock, so a buzz sent after it is never dropped as early.

Where: `server/e2e.ts` (`FakeClient.open`, `request`, `flush`, `untilOpen`), `server/hub.ts` (`handle`, `join`)
