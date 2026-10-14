---
id: 043
title: The Poker phone explains itself after a fold
kind: ux
size: S
judge: opus
status: proposed
lens: ux
proposed_by: f3e13ca3-5996-4d39-839c-6ee6289499ff
proposed_on: 2026-10-14
---

## Opportunity
A folded Poker phone keeps its live controls.

![Dee's phone after the shot clock folded her](assets/043-phone.png)

Measured at 390×844 after the shot clock auto-folded Dee: a "FOLDED" print
at the top, "AUTO-FOLDED" in tally mid-felt, then "CALL 0 · WIN 90", a pot
meter at 0× and a stack meter at 0%, "BO TO ACT", the four reactions, and
Raise and All in at full strength at the bottom. Dee cannot raise; the
buttons say she can. The design guide §8: "Never show a disabled control
with no reason." It also never says what happens next or when.

## Proposal
A folded hand (by flick or by clock) swaps the action strip and the
call/win line for one sub-line in the felt's own type: "Folded · next hand
after this one" (or "Folded by the clock · …" for an auto-fold), keeps the
reactions row, and shows the pot and the street's cards as the board shows
them, so a folded player still follows the hand. The meters stay hidden
until the next deal. A busted player gets "Out · you finished 5th" the same
way.
In: the folded and busted states of the phone. Out: the fold gesture, the
clock, the board.

Judge: opus, because the states and strings are pinned and the work is one
component's branches.

## What you'll see
Fold, and the phone says so and why, shows the pot growing without you, and
offers only reactions until the cards come round again.

## Verification
`npm run build`, `npm test`. `npm run sim-poker -- solo` with a phone
joined: fold by flick and by clock; both read correctly and no dead button
shows.

## Risks and the alternative considered
Hiding Raise removes a target a player might be about to tap when the clock
fires; a 300ms fade avoids the mis-tap landing on a reaction. Alternative:
grey the buttons; rejected because grey without a reason is the thing the
guide forbids.

## Needs from Rick
