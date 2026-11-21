# The ready fallback latches once it has run out

Under autoplay a match opened by automation starts when every connected player is ready or when `READY_FALLBACK_MS` runs out. If the start is refused when the fallback fires (for example, teams are not yet picked), the fallback stays fired, and any later change that makes the start legal (a team pick, a join) starts the match at once rather than waiting another full fallback.

Where: `server/hub.ts` (`nightStep`, `nightTimer`, `nightStart`)
