---
id: 021
title: Duel predictions: the sofa backs a seated player before the arm
kind: feature
size: M
judge: opus
status: proposed
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
---

## Opportunity
A duel seats two and benches everyone else: the phone says "you sit this one out" and the buzzer does nothing for them (manual checklist, "The room votes"). In `setlists/quick-night.json` the last four questions are duels, so a third of the night the room has nothing to do but watch. The roadmap's project 5 is exactly this gap: "Duel predictions: spectators privately back a seated player before arming; room sees the aggregate after resolution", with "no points initially; preserve secrecy, rebound scope, ties, and cancellation". PRODUCT.md principle 2 wants the phone "engaging for each player".

## Proposal
Once `duel.seated` is set and until the arm, every unseated connected phone shows the pair as two big names; a tap backs one (`predict` act, `DuelState.backing: Record<PlayerId, PlayerId>`, redacted in `viewFor` to the viewer's own and never sent to the board or the seated phones before the verdict). On the verdict that ends the question, the board's stamp gains a line, "7 backed Ada · 2 backed Bo", and the phone says whether you called it. A block option `predictionValue` (default 0, in `SetlistBlock.options` for duel blocks) pays that many points to each right backer through `shared/scoring.ts`; the wrong lose nothing. Cancelling the duel or a reset clears the backing; a rebound keeps it (same question). In: duel state field, act and legality, redaction, board line, phone backing screen, option. Out: odds, backing on non-duel questions, a betting pool that moves points between players.

Judge: opus, because the roadmap and this page pin the rules and the work is one more field through duel, redaction, wall and two surfaces.

## What you'll see
The pair is seated; nine phones show "Ada | Bo"; the room taps. Ada wins and the stamp reads "+300 · 7 backed Ada". Hal's phone: "You called it".

## Verification
`npm test`: `duel.test.ts` for backing admission (seated players refused, after the arm refused, a second tap changes the pick), redaction before and after the verdict, clearing on cancel and keeping on rebound, payout at value 0 and 50. `npm run build`; `walk-duel` gains `back:Cy=Bo,Dee=Fen` and the checklist two lines.

## Risks and the alternative considered
Backing leaks before the verdict would change the duel: the board and the seated phones receive nothing until `award` exists. Ties in a vote duel are already resolved by the seat rule. The alternative, a reaction button, is noise with no stake; the roadmap chose a commitment, and a commitment is what makes the room lean in.

## Needs from Rick
