---
id: 052
title: The fit check flags a surface taller than the screen even when it clips
kind: maintenance
size: S
judge: opus
status: proposed
lens: eng
proposed_by: party-buzzer-build-1 operator session
proposed_on: 2026-11-04
from_feedback: party-buzzer-build-1 (party-buzzer-046) #4370
---

## Opportunity
`tools/review/fits.spec.ts` cuts every box to its clipping ancestors before
the bounds test (`fits.spec.ts:59-79`), so content cut off by the board's own
`overflow: hidden` never counts as leaving the screen. During 046 the board's
wall was 756px on a 720px screen, the "+60" readout clipped at 1024×600 and
the lockout chips' foot was off-screen, and every scenario passed.

## Proposal
Add one bound per scenario: the surface's root clipping element (the board's
`main`, the phone's root) must not be larger than the viewport, and a box
clipped by that root (not by a deliberate scrolling list or well) counts as
leaving the screen. Existing exemptions (`data-overlap`, `aria-hidden`,
scroll containers) keep working.
In: the checker and its own test cases. Out: fixing whatever it then finds,
beyond listing the failures in Shown and filing each as feedback.

Judge: opus, because telling a deliberate clip from a lost readout needs care.

## What you'll see
A board whose wall overflows the screen fails `npm run test:review` with the
clipped element named.

## Verification
`npm run test:review` in full; a fixture that reproduces 046's 756px wall
fails before the fix of 046's CSS and passes after (check out `de6728f^`'s
style rule in a scratch scenario).

## Shown

## Risks and the alternative considered
It may turn up existing overflows; the spec lists them instead of fixing them,
so the change stays S. Alternative: check only the board's height; rejected
because phones clip the same way.

## Needs from the operator
