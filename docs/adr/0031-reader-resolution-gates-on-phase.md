# The reader calls a question over only when its round is idle

The reader's `resolved` check requires `round.phase === 'IDLE'`, not just a stamped `round.award`. A wrong answer with a penalty stamps the award while the buzzers reopen for the rebound and the clue still has more to say, so treating the award alone as resolution would end the question early. Likewise a question nobody judges stays `ARMED` after the reading ends, so a late buzz still lands.

Where: `server/reader.ts` (question loop, `resolved`)
