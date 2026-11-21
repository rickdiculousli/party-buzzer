# Times on the wire are server-clock milliseconds

Every timestamp and deadline in `State` and in minigame frames (`BuzzEntry.at`, `round.closesAt`, `round.reveal`, Poker's `actBy` and `nextLevelAt`, Sketch and Tug `endsAt`, Tank `reloadUntil`, minigame `status[].until`) is in the server's `Date.now()` domain. Browsers convert through the clock offset that `useSocket` samples; comparing one of these to a browser's own `Date.now()` directly is a bug on any device whose clock drifts.

Where: `shared/protocol.ts` (`BuzzEntry`, `Round`, `PokerShared`, `SketchShared`, `TugShared`, `TankFrameWeapon`, `MinigameState`), `client/useSocket.ts`
