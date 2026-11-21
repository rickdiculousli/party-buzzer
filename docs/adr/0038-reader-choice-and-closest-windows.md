# Choice and closest windows close on a timer flag and settle after a beat

- A choice question's countdown starts when the voice finishes reading the options, so the read-out does not eat the room's time; once everyone has picked, the rest of the options are not read.
- The deadline timer sets an `expired` flag rather than the wait re-checking the clock: a timeout can fire a millisecond before the clock reads the deadline, and a clock re-check would then wait forever.
- The host's Close publishes `closesAt` (or `guessing.closesAt`) as now, at the moment of Close, not at the settle, so no pick or guess lands in the beat before the answer and the board's bar reacts at once.
- `LOCK_BEAT_MS` holds one second between the window closing and `settleChoice`/`settleClosest`, so the room sees that everyone is in before it is told who was right.

Where: `server/reader.ts` (`runChoice`, `runClosest`, `LOCK_BEAT_MS`)
