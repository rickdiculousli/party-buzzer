---
id: 016
title: Closest-guess question: everyone types a number, the nearest takes it
kind: feature
size: M
judge: opus
status: accepted
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
---

## Opportunity
"How tall is Everest?" is a terrible buzz question (`packs/walk-trivia.txt` has it, and nobody buzzes in the walkthrough: "it reveals its answer and passes") and a great room question when everyone has to commit to a number. The choice kind already shows the shape: every eligible phone acts once, `closesAt` bounds it, `pickers` in `shared/choice.ts` decides who counts, and `settleChoice` pays without mode hooks. PRODUCT.md principle 2 wants the phone "equally clear and engaging for each player"; on a choice question the phone has four buttons and on a buzz question it has one, and a player who knows nothing has nothing to do.

## Proposal
`K: closest` in `shared/pack.ts`, with a numeric `A:` and an optional `U: metres` unit line. The Reader runs it as it runs a choice: reads the question, publishes `round.guessing = { unit, closesAt }`, waits for every picker, the deadline (`choiceSec`), or the host's close, then dispatches `settleClosest`. Phones submit a `guess` act with a number; `Round.guesses` is redacted to the viewer's own in `viewFor`. Scoring in `shared/scoring.ts`: the nearest guess takes the value, ties share, and with six or more guessers the second-nearest takes half; an exact hit doubles. The board puts every guess on a number line scaled to the guesses, then slides the truth in and lights the winner. The phone has a number pad with the unit and the typed value large. In: pack kind and its style guide page, Round fields, Reader phase, legality, settle action, wall moment, phone pad, board line, ten questions added to `packs/game-night.txt`. Out: ranges or tolerance in the pack, wagering (see 011 and 021 for where risk lives), log-scaled lines.

Judge: opus, because the rules and scoring are pinned and the work is threading a fourth kind through pack, reader, legality, wall and two surfaces along the groove `choice` cut.

## What you'll see
"How many steps are in the Eiffel Tower to the top?" Nine dots land on a line as the phones commit. The line holds a beat, then 1,665 slides in from the right; Cy's 1,700 lights brass with "+200 · 35 off", Fen's 1,500 takes half.

## Verification
`npm test`: scoring tests (ties, exact hit, fewer than six guessers, a disconnected picker not blocking the close), redaction, a non-numeric guess refused. `npm run build`; `walk-read-trivia` gains a closest question with `guess:Ada=1700,Bo=1200,Cy=1500`.

## Risks and the alternative considered
One wild guess makes a bad scale: the line clips to the middle 90 % of guesses and parks outliers at its ends with their numbers. Phones without a numeric keyboard type slowly: the pad is in-app. Alternative: express it as a choice question with ranges; rejected because the room commits to nothing and nobody's own number is on the wall.

## Needs from Rick
