# Browser clock sync, scheduled opening and reconnection

Every surface runs its own socket and its own estimate of server time, and timed moments are scheduled on that estimate rather than on packet arrival.

- `now()` is `performance.now()` plus an offset, so a phone whose wall clock jumps cannot corrupt it. The offset is seeded from `Date.now()` so it is usable from the first render, then refined NTP style: of several ping samples, the fastest half by round trip is kept and its median offset taken, because slow round trips are the ones WiFi jitter distorts.
- The buzzers open at the server's `armedAt` on each surface's own clock, so a phone whose arm packet arrived late still opens with everyone else. The timer that fires is the authority for "open"; re-reading the clock at render would leave a surface shut when `setTimeout` fires a hair early. The wait is clamped to `ARM_DELAY_MS`, because a device clock that is behind would otherwise wait indefinitely; an arm heard late opens at once.
- Countdowns derived from a server deadline clamp to the most they can be (the arm delay, or the answer window's cap in `TalkCountdown`), since an unsynced or skewed clock can make the raw difference absurd.
- `useFinale` keeps `ticks` as an effect dependency on purpose: a timer can fire just before a step boundary, and the only cure is to reschedule from where the clock now is. A spent setlist with no `spentAt` stamp (an older saved game) counts as already settled.
- A player with no stored id sends no `hello` on connect, because that would mint an unnamed player; the join tap sends the first one.
- `send` reports whether the message left. A message sent while the socket is down is dropped, never queued.
- Practice pulses and reactions are local receipts and are never replayed: a reconnect clears them.
- The watchdog abandons a socket that has heard nothing for `BEAT_MS * BEAT_MISSES` and reconnects without waiting for a close handshake, which can hang on a dead link. (The heartbeat itself is in ARCHTECTURE.md, "Startup and change propagation".)

Where: `client/useSocket.ts` (`medianOffset`, `useOpen`, `useFinale`, `useSocket`), `client/Talk.tsx` (`TalkCountdown`)
