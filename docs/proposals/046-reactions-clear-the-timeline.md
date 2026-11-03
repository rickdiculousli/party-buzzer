---
id: 046
title: Reaction pills clear the timeline on a 720p board
kind: refinement
size: S
judge: opus
status: proposed
lens: ux
proposed_by: party-buzzer-build-1 operator session
proposed_on: 2026-11-03
from_feedback: party-buzzer-build-1 (party-buzzer-036, party-buzzer-044)
---

## Opportunity
Spec 036's reaction pills land on the timeline's labels on a smaller board.
`npm run test:review` on `main` fails `answering-reactions board fits` at
1280×720 and 1024×600: `span.timeline__name × span.board__pill` and
`span.timeline__ms.readout × span.board__pill`. Measured at 1280×720, the
pills rest at y 647–686 and the second timeline row's names and deltas sit at
611–684. The timeline itself ends at 724, past the 720 board, so there is no
band under it to rise into. At 1920×1080 the pills rest at 917, clear of the
readouts' 907. The guide (036's own spec) says nothing covers the name or
the stamp, and since 038 the timeline deltas are the room's read after the
slam. 036's lead reported the fit check green; it most likely measured
another worktree's server on the then-shared port 4174 (fixed by cbfa7d8).

## Proposal
Pills never rest over a timeline readout at any fit-check size. Where the
band under the timeline is too short for a pill (`client/style.css`
`.board__pills` and `.board__pill-slot`, and the `--rows`/`--cols` the board
sets in `client/Board.tsx:322`), the pills take a lane that is free: the
builder picks between a smaller pill on short boards, a rest beside the
timeline's rail rather than under it, or rising and fading before the rail.
In: the pill layer's placement and size at short boards. Out: the timeline,
the cap of 6 and the "+N" chip, the server relay, the phone row.

Judge: opus, because the constraint is measurable and the choice among three
placements is small.

## What you'll see
At 1280×720 with a two-row timeline, six pills rise and fade without touching
"Cy +120"; at 1920×1080 nothing changes.

## Verification
`npm test`; `npm run test:review` in full, with `answering-reactions board`
passing at every size and no `data-overlap` exemption added for the pills.
`adversarial-qa` readability critic on the pill frames at 1280×720.

## Shown

## Risks and the alternative considered
Shrinking pills on short boards loses room-scale legibility; the critic
judges that. Alternative: mark the pill layer `data-overlap` so the check
passes; rejected because it hides exactly the collision the room would see.

## Needs from the operator
