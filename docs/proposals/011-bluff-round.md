---
id: 011
title: Bluff round: everyone writes a lie, the room picks the truth
kind: feature
size: L
judge: fable
status: later
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
---

## Opportunity
Every quiz question today rewards the one person who knows. A trivia night's loudest moments at a real party come from the opposite: a lie that fooled half the room. PRODUCT.md principle 2 asks the board to be "engaging for the room" and the phone "engaging for each player"; a buzz question engages one phone at a time, and the choice kind (`shared/choice.ts`, `runChoice` in `server/reader.ts`) already proves that every phone can act at once on one question. Nothing in the three kinds (`read`, `shown`, `choice` in `shared/pack.ts`) lets a player contribute content to a question.

## Proposal
A fourth question kind, `K: bluff`, with a normal `A:` line. The round has two phases, both while `ARMED` and both owned by the Reader like `runChoice`: **write**, where every eligible phone types a plausible wrong answer (`Round.lies`, redacted in `viewFor` to the viewer's own, duplicates of the truth or of another lie refused with a reason), then **pick**, which reuses `choices`, `picks`, `closesAt` and `pickers` with the choices being the shuffled unique lies plus the truth. A new `settleBluff` action pays the value to every right pick and half the value to a liar per player fooled, through `shared/scoring.ts` and without mode hooks, the same bargain `settleChoice` makes. The board shows the lies landing one by one as they are written (anonymous), then the picks, then the truth lighting and each lie's author revealed with who it fooled. In: pack kind, Round fields, Reader phases, legality, settle action, wall moment family `bluff`, phone write and pick screens, board reveal, `docs/question-styles/bluff.md`, a starter pack of 15 bluff questions. Out: a free-text matcher for right picks (a typed lie equal to the truth is simply refused), items and duels on a bluff question (refused like choice), ElevenLabs reading the lies aloud.

Judge: fable, because the reveal beat and how the lies read on a wall are the whole feature, and the spec cannot pin them.

## What you'll see
The voice asks "What was the original name of the game Pac-Man?" Phones show a keyboard; the board fills with seven cards as they land. Then everyone picks; the truth lights brass, "Puck Man"; the two lies that caught the most people flip to show their authors and the room laughs at Dee.

## Verification
`npm test`: pure tests for lie admission (truth and duplicates refused, case-insensitive), payout per fooled player, redaction of `lies` and `picks` in `viewFor`, and that undo during the write phase drops the lies with the attempt. `npm run build`, then a `walk-bluff` probe script beside `walk-read-trivia` and the `review-workbench` for the three board states.

## Risks and the alternative considered
A slow typist stalls the room: the write phase ends on a timer (`Choice time` reused, default 45 s here) as well as on everyone done, and a phone that wrote nothing just picks. Lies need writing rules or the matcher refuses honest near-misses; the style guide and a refusal reason on the phone carry that. The alternative, a host-typed list of decoys per question in the pack, is a choice question with better options and makes nobody laugh at Dee.

## Needs from Rick
