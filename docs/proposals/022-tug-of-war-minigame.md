---
id: 022
title: Tug of war: a thirty-second minigame the whole room shouts through
kind: feature
size: M
judge: opus
status: proposed
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
---

## Opportunity
The five minigames are all skill or knowledge games with a learning curve (Bow aim, Tank crews, Ink writing, Sketch, Poker), each 2 to 15 minutes. There is no thirty-second, no-explanation, everyone-at-once game to put between quiz blocks, which is the thing a setlist needs most as a palate cleanser (the roadmap's project 2 talks about "score balance" across a night). The framework makes a new minigame a known shape: a `MinigameDefinition` (`server/minigames/definition.ts`), two client registry rows (`client/minigames.tsx`, `client/minigame-info.ts`), an `MINIGAME_OPTIONS` entry; Bow's whole client side is 187 lines across three files.

## Proposal
`tug`: at Start the room splits into two sides (teams if the grouping is teams, otherwise alternating by join order), each phone shows a rope handle, and a tap pulls with diminishing return per tap in a 300 ms window so mashing pays but rhythm pays more; the server sums pulls per side with a sagging spring so a lead can be clawed back. The board shows the rope, a centre flag and the two sides' names; first to drag the flag past the mark, or the side ahead at `durationSec` (default 30), wins, and every member of the winning side gains `value` (option, default 100) through the normal results commit. In: definition, world and tests, registry rows, phone and board surfaces, three cues from the existing kit, README section and `MINIGAME_INFO` goal line, the quick-night setlist swaps Bow for it. Out: more than two sides, a practice round, haptics beyond the existing press buzz.

Judge: opus, because the rules are pinned here and the path is the framework's own: every file a new minigame must touch is known, and none of them is taste.

## What you'll see
"Tug of war: tap to pull. Red vs Blue." The room counts down, the flag jitters, the sofa screams, Blue drags it over at 22 seconds and +100 lands on four names.

## Verification
`npm test`: world tests (diminishing taps, spring, winner at the mark and at time, odd rooms split fairly, a disconnected puller counts for nothing), `minigames.test.ts` registry parity. `npm run build`; a `sim-tug` bot script like `sim-bow`, then `adversarial-qa` on the rope motion.

## Risks and the alternative considered
Tap floods: 12 phones at 10 taps a second is 120 inputs a second over the existing socket, well under Bow's aim stream; inputs are `continuous` and coalesced per step. A one-sided split makes a dull game: alternating by standings instead of join order balances strength. The alternative, Hot potato, is more memorable but needs a pass-to-name UI and a social rule; Tug is the smallest game that makes a room loud.

## Needs from Rick
