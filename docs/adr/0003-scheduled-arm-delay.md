# Buzzers open at a scheduled server instant, on each surface's own clock

An arm or a rebound sets `round.armedAt` `ARM_DELAY_MS` ahead instead of opening on arrival, and every surface opens at that server instant on its synced clock, so a phone whose packet lands late on the party WiFi still opens with everyone else; the delay covers LAN jitter and is short enough that the host never notices it. The timer that fires is the authority for "open", since re-reading the clock at render leaves a surface shut when `setTimeout` fires a hair early, and the wait is clamped to `ARM_DELAY_MS`, so a device clock that is behind opens at once rather than never. Clients count down against the constant, so changing it changes both ends.

Where: `shared/protocol.ts` (`ARM_DELAY_MS`), `server/state.ts` (`applyHostAction` `arm`, `openRebound`), `client/useSocket.ts` (`useOpen`)
