# Player names have no length limit

The server accepts a player name of any length, so every surface that shows names (the board's chin, the phone bar, lobbies, standings) must lay out long names without breaking. The review deck keeps long-name scenarios for exactly those layouts, and `npm run test:review` checks they fit.

Where: `tools/review/fixtures.ts` (`ink-long-names`, `ink-lobby-long-names`), `tools/review/ink.ts` (`INK_LONG_NAMES`)
