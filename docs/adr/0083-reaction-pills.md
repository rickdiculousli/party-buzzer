# Reaction pills: columns, overflow and motion

The layout of the board's reaction pills is in `docs/design.md` (Board, Reactions); these rules keep it working:

- A receipt is given the lowest free column when it arrives, or none when every column is taken. One without a column only adds to the "+N" chip and is never promoted later, because a pill mounted late would be cut mid-rise by its own expiry clock. The chip's count ends with the last visible pill, since a chip alone over an empty band counts nothing the room can see.
- Each column scales its rest height by `--lift` (from `LIFTS`), so a batch sent in one instant never settles into one straight row. Under a timeline with more than one row the pills drop the lift and sit in one row, because the band is too shallow.
- The rise travel is the rest height but never less than `6vh`, so under a deep timeline a pill still visibly rises.
- The slot's fade uses the symmetric `--rate-even` ease, so the reversed fade reads as a fade rather than an ease-in cut. A pill whose band shrinks under it fades early with `filter: opacity(0)`, not `opacity`, so it never fights the slot's own fade animation.
- A frozen frame (the review workbench) turns pill animations off; their fades would otherwise run on the wall clock and leave the frame empty.

Where: `client/reactions.ts` (`recordReaction`, `shownPills`, `LIFTS`), `client/reactions.test.ts`, `client/Board.tsx` (`Reactions`), `client/style.css` (`.board__pill-slot`, `.board__pill`, `.board__pills.is-frozen`)
