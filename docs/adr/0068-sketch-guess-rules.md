# Sketch judges guesses so the room never sees the answer early

- A right guess's time comes from the phone's press stamp, clamped between the drawing's start and the step that applied it, so network delay neither helps nor hurts and order follows the presses.
- "Close" means one edit away, and only on words of four or more letters, so a close hint does not give a short word away.
- A guess that contains the word counts as close, never as a miss, because misses are shown on the board and would show the room the answer.
- A hint never reveals the last hidden letter.

Where: `server/minigames/sketch/definition.ts` (`correctView`), `server/minigames/sketch/match.ts` (`isClose`), `server/minigames/sketch/world.ts` (`guess`, `revealHint`)
