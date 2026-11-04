---
id: 046
title: Reaction pills clear the timeline on a 720p board
kind: refinement
size: S
judge: opus
status: done
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

Built as the smaller pill on short boards, with the band measured rather than
modelled:
- The board's grid row is the screen's height (`.board`, `grid-template-rows:
  100%`). Its implicit auto row had let the wall grow to its content, 756px on a
  720px screen, which carried the pills' foot (and the 1024x600 "+60") off the
  screen.
- The pill layer stays mounted and measures how far the lowest timeline
  readout sits above the wall's foot. A full pill rests at most a gap under it.
  Where the band can't hold a full pill above the foot row and no lockout chip
  is up, pills rest in the foot row at down to the deltas' 1.2x type, leaving
  the count chip's lane free. Shorter still, the receipt counts in the "+N"
  chip, which replaces the fixed "three rows" rule.
- A pill keeps the lane it was born in; one whose band shrinks below that lane
  fades early where it is (from the readability critic).
- Beside the rail was rejected: 28-37px of margin at short sizes.

## What you'll see
At 1280×720 with a two-row timeline, six pills rise and fade without touching
"Cy +120"; at 1920×1080 nothing changes.

## Verification
`npm test`; `npm run test:review` in full, with `answering-reactions board`
passing at every size and no `data-overlap` exemption added for the pills.
`adversarial-qa` readability critic on the pill frames at 1280×720.

## Shown
- At 1280x720 with a two-row timeline, six pills clear the second row: probe of `answering-reactions` on the board -> `timeline__ms readout 139-185 x 641-666 +60` and `board__pill fx-rise 48-158 x 675-708 Too slow` (all six at 675-708)
- At 1920x1080 nothing changes: same probe -> `board__pill fx-rise 60-244 x 915-973 Too slow`, against 918-975 before the change
- They rise and fade without touching it: frames of the real board at 1280x720 with the pills' own animations scrubbed from 0 to 2399ms (`node cache/046/film.mjs`), read by the builder and the critic
- `answering-reactions board` passes at every size, with no `data-overlap` added: `npm run test:review` -> `314 passed (1.2m)`; `git diff main...HEAD | grep -c data-overlap` -> `0`
- `adversarial-qa` readability critic on the pill frames at 1280x720: one round. Fixed: live pills jumped lane and size, or landed on the readouts, when the band changed under them (`is-cleared`, birth lane kept), and the low rise started off-screen (3vh). Checked by resizing a loaded board -> `1920,1080 -> 1024,600: high,... => is-cleared,...` and `1280,720 -> 1920,1080: is-low,... => is-low,...`
- Easy to miss: 1024x600 as well as 1280x720, where no pill fits under a two-row timeline, so the receipts count instead of resting on "+60" (544-568): probe -> `chip board__pills-more fx-fade 635-720 x 548-576 Ooh +6`
- Not shown: a TV at three metres, and overscan on a real set cropping pills that sit 12px from the edge: nothing here is a TV

## Risks and the alternative considered
Shrinking pills on short boards loses room-scale legibility; the critic
judges that. Alternative: mark the pill layer `data-overlap` so the check
passes; rejected because it hides exactly the collision the room would see.

## Needs from the operator
