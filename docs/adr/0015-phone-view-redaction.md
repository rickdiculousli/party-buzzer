# Why phone views drop reading progress and checkpoint data

The redaction rules themselves are in ARCHTECTURE.md; these are the reasons behind two of them:

- Text mirroring defaults off for quizbowl because reading a sentence at its start beats hearing it word by word. Reader progress (`reading`) is never sent to phones even with the mirror on: `fragIndex`/`fragTotal` would tell a player the question is about to end before the room has heard it, and it carries the pack filename.
- A minigame checkpoint's `data` can hold secrets such as Poker's deck seed, so every view, host and board included, gets only its `version` and `label`.

Where: `server/hub.ts` (`viewFor`)
