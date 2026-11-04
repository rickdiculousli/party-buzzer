---
id: 054
title: The Bow phone fits at ready and results, and the Poker phone's lamp clears its text
kind: ux
size: S
judge: opus
status: proposed
lens: ux
proposed_by: party-buzzer-build-1 operator session
proposed_on: 2026-11-04
from_feedback: party-buzzer-build-1 (party-buzzer-032) #4406
---

## Opportunity
Spec 032's new minigame review scenarios found phone layouts that don't fit,
and made the scenarios board-only (`phones: []`) because phones were out of
its scope: the Bow phone at ready and results scrolls 28–112px at 375×667 and
360×560, and the Poker phone's `felt__lamp--phone` (spec 042's lamp, not
`aria-hidden`) overlaps its text.

## Proposal
Give those scenarios their phones back and make them fit: the Bow phone's
ready and results views fit the phone sizes without scrolling, and the Poker
lamp takes its own space beside the name. In: the two views' CSS and the
scenarios' `phones`. Out: the bow control, Poker's felt layout.

Judge: opus, because the Bow view must give up height without hiding the instruction.

## What you'll see
On a small phone the Bow results fit on one screen, and the Poker header's
lamp sits beside the name, not on it.

## Verification
`npm run test:review` in full with the phones restored to 032's Bow and Poker
scenarios, all passing.

## Shown

## Risks and the alternative considered
Alternative: mark the lamp `aria-hidden`; rejected because it would hide a
real overlap from the check, not fix it.

## Needs from the operator
