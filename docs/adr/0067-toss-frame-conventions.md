# Poker card motion: frame conventions

The motion itself (air then cloth, hands not keyframes) is described in docs/design.md, "Poker — the late room". These are the conventions consumers of `Frame` lists rely on.

- `turn` is degrees about the card's hinge: ±180 face down, 0 face up. Its sign is the one that lifts the far side off the table rather than through it, matching CSS `rotateY` (a positive turn with a right-edge hinge lifts the left side). `z`, when present, is pile order, higher on top; turning a pile over reverses it.
- A card is turned over by lifting one edge, so it rocks on the other and lands most of a card's width over (`REVEAL.hinge`). A frame's pose is where the card lies face up; face down it lies the hinge's swing away. `turnUp` places the hinge so each card's face-down pose is exactly where it already lay, toward the table's middle. Street cards hinge on the right edge so face down they lie past the board's end, not over the neighbouring card.
- A turn is sampled finely, since a frame list otherwise has only the ends of a hold.
- `simplifyFrames` measures error at the original timestamps so browser linear interpolation keeps the pace, and keeps contacts, pauses, taps, turn endpoints and stacking changes exact, because cues are scheduled from those contacts.
- A fold's reach is capped as `(reach - keepClear) / (1 + wobble)`: along any heading within a right angle of the aim, stopping `keepClear` short keeps that distance, and the bow gets its own margin.

Where: `client/toss.ts` (`Frame`, `simplifyFrames`, `turnedOver`, `flop`, `turnUp`, `street`, `toss`, `REVEAL`)
