# Display moments come only from facts every role receives

`momentOf` reads only the fields `viewFor` sends to every role (`phase`, `armedAt`, `spoken`, `award`, `held`, `duel`, `buzzable`, `arrival`, `readingActive`), never `order`, `whole` or mirrored text, so the board and every phone compute the same moment from differently redacted state; names travel on `Wall`, never on `Moment`. State says what happened the instant it happens and the board says it at the speed a room reads, so the time-dependent facts arrive as `Local` clocks the client owns (`open`, `settled`, `retired`) rather than being read inside, which keeps `shared/wall.ts` pure and runnable under `node:test`. Only the board waits on `settled` and `retired`; the host desk and phones pass both as true, because the desk must keep its judging keys while the board types.

Where: `shared/wall.ts` (`momentOf`, `Local`, `Moment`, `Wall`), `client/useReveal.ts` (`useReveal`), `server/hub.ts` (`viewFor`)
