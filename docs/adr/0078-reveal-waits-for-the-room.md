# The wall reveals at the speed a room reads

`State` says what happened the instant it happens; the board says it at the speed a room can read. `useReveal` owns that second timing and answers in two booleans, `settled` and `retired`, which `wallOf` consumes.

- The verdict waits on the sentence: while a judge's transcript is typing out, the award (stamp, name, answer, thud) is held until `Spoken` reports the line landed. `settled` is derived during render from a key, not latched by an effect, because the transcript and the award arrive in the same broadcast and an effect would show the award for one frame first. Nothing spoken means nothing to wait for.
- The award thud is keyed on what the award says (name, points, penalty or not), not on object identity, since each broadcast is a fresh parse. The arm instant stays out of the key: a rebound restamps `armedAt` while the penalty is still up, and including it would re-sound the penalty and restart its dwell. An undo clears the award, which empties the key, so a rejudge to the same number still sounds.
- A penalty retires after `--penalty-dwell`, because a rebound is the same question still being read and the stamp must not sit over it. A payoff never retires. The retired key is forgotten whenever no penalty is up, so an identical later penalty is not pre-retired.

Where: `client/useReveal.ts` (`useReveal`), `client/Spoken.tsx`
