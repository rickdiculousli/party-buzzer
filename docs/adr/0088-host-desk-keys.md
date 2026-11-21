# What the host keys do

The desk is driven from a laptop keyboard, and some keys follow the slot rather than a fixed action:

- Keys fire only while the quiz desk is in front of the host: not behind the Games or Players tab, not under a minigame, and not while a setlist waits on an unopened minigame block.
- Space is the next thing to do: Correct when someone is judgeable, Arm when idle, and nothing while the buzzers are up, since re-arming there would throw the question away.
- Shift calls a miss; on an untaken rebound (a miss up, nobody buzzed) Shift and the Arm button give up on the question by arming the next one.
- During a held rebound, Reopen takes the Correct slot (letting the host skip the wait rather than sit out `reboundSec`), R fires it, and C fires it too because the host's hand goes to C. This is safe only because the server's `rebound` changes nothing when no miss is held.
- The desk judges a retake that locked while the previous miss's penalty award is still up; the server allows it and the award passes to the new leader.

Where: `client/Host.tsx` (`Host` key handler, `QuizDesk`), `server/state.ts` (`applyHostAction` `rebound`, `correct`)
