---
id: 053
title: The filmstrip films a review scenario at a board size and keeps the frames honest
kind: time-cost
size: S
judge: opus
status: proposed
lens: eng
proposed_by: party-buzzer-build-1 operator session
proposed_on: 2026-11-04
from_feedback: party-buzzer-build-1 (party-buzzer-046, party-buzzer-050) #4371 #4421
---

## Opportunity
`npm run qa:film` runs the motion harness at 1400×1000 (`tools/qa/filmstrip.ts:51`)
on static markup: the reaction scenario never runs the `Reactions` component,
and the review frame injects a zero animation duration. 046's lead wrote a
scratch script to film the real board. 050's lead found the sheet misleading:
it collects every in-effect animation at 900 ms, so a finished `fill: both`
entrance (`fx-pop`) is rewound and frame 0 shows the list invisible, while a
300 ms `fx-flash` on the take has already ended and is missed.

## Proposal
`qa:film` gains `--review <scenario> --size WxH`: it opens the review frame
for that scenario and surface at that size without the injected zero
duration, and scrubs `document.getAnimations()` as the harness path does. In
both modes it films only animations that start at or after the moment it
names, and captures from the moment's start, not 900 ms in.
In: the flag, the start filter, the capture time. Out: real-time recording, sound.

Judge: opus, because the start filter changes what every critic sees.

## What you'll see
`node tools/qa/filmstrip.ts --review answering-reactions --size 1280x720`
writes a sheet of the real pills rising on the real board.

## Verification
`npm test`; the 050 standings take filmed both ways shows the flash in the
sheet and no invisible frame 0; the adversarial-qa skill's evidence section
names the flag (through `skill-shaper`).

## Shown

## Risks and the alternative considered
Changing the capture time changes existing sheets; critics read new ones.
Alternative: a separate tool for review scenarios; rejected as a second copy
of the scrubber.

## Needs from the operator
