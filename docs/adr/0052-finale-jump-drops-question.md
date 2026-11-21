# Jumping to the end clears the question for the finale

A `setlistJump` to the end of the setlist is the finale (and Replay). It drops the question and everything the room could still read of it (award, transcript, typed clue, judge window) through `dropQuestion`, the same clear `next` does, so a leftover result does not hold the stage while the ceremony's clock runs under it.

Where: `server/state.ts` (`dropQuestion`, `mutateHostAction` `setlistJump` case)
