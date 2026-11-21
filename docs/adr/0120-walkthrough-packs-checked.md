# Walkthrough packs are checked against the answers their scripts speak

`npm run walk-read-quizbowl` and `npm run walk-read-trivia` speak answers aloud and assert scores. If a pack edit stops an answer landing on the expected side, the walkthrough becomes a minute of audio ending on wrong numbers with nothing saying why, so unit tests check each pack against the words, picks and guesses its script uses. The quizbowl walk's second question must keep at least four fragments, because the script's buzz offsets put the miss and the rebound two sentences apart.

Where: `server/match.test.ts`, `packs/walk-c.txt`, `packs/walk-trivia.txt`
