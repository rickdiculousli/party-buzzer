# Hub `act` messages: who may send them, and what each publication means

Items, duel entry, picks and guesses belong to players. Every other act (fragments, answers, judge windows, reader controls, setlists, module acts) is host-scoped: the reader and judge connect as host, and a phone must never be able to reveal a fragment early or close the power window for itself. Duel entries are ignored while an introduction is up, because the introduction covers the nomination window; they wait until the host continues.

The reader and judge publications are runtime facts, not host actions:

- `extend` replaces only the last fragment, and only with a longer string, so the board can follow the voice a clause at a time while `fragments` stays a list of fragments (what `fragTotal` and quizbowl's power boundary count).
- `judgeWindow` with `{}` is the open-ended window: presence means "offer push-to-talk", and only `until` carries a countdown.
- A `reading` update that turns `readingActive` on is real play starting: it ends the lobby and drops a typed clue in favour of the pack's.
- `selectPack` is refused unless the round is `IDLE`, the way `setMode` is, since a switch mid-question would cut the room off.
- `typeClue` is runtime: no undo step, and an empty string clears it.
- `rewindRead` has no host button on purpose (Read resumes); it exists so scripted walkthroughs get a known starting frame.

Where: `server/hub.ts` (`act`)
