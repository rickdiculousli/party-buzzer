# Arming opens the buzzers at a scheduled instant

An arm (and a rebound) sets `round.armedAt` to `ARM_DELAY_MS` in the future instead of opening the buzzers on arrival, so every surface opens at the same real instant however late its packet lands on the LAN. The delay is long enough to cover LAN jitter and short enough that the host never notices it. It is part of the wire contract: clients count down to `armedAt` and cap that countdown at `ARM_DELAY_MS`, so changing the constant changes both ends at once.

Where: `shared/protocol.ts` (`ARM_DELAY_MS`), `server/state.ts` (`applyHostAction` arm, `openRebound`), `client/useSocket.ts` (opening countdown)
