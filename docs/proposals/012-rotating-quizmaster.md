---
id: 012
title: Rotating quizmaster: a player's phone reads and judges a block
kind: feature
size: L
judge: fable
status: later
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
---

## Opportunity
The host is the only person who cannot play. A block without a pack is "read aloud by the host" (README, Play), and even with the voice reading, only `/host` can press Correct or Wrong (`shared/legality.ts` ladder, host connections in `Hub.dispatch`). At a party of eight that is one friend behind a laptop all night. PRODUCT.md's purpose is "a shared party game night"; principle 1 wants the next valid action clear to whoever is running the moment. The redaction rules already carry private material to one role (`round.whole` and `round.answer` are host and board only), so one more private recipient is a projection, not a new transport.

## Proposal
A per-block setting `quizmaster: 'host' | 'rotate'` on `SetlistBlock`, default `host`. In a rotating block the Reader loads the pack as now but does not speak; at each arm the server names `round.quizmaster` (the next player by join order, skipping whoever read last), excludes them from `buzzable`, and `viewFor` sends that one phone the whole question, the accepted answers and a judge desk: Read it out, Correct, Wrong, Next. `Hub.dispatch` accepts `correct`, `wrong`, `next` and `arm` from a player connection only when its id equals `round.quizmaster`; the shared ladder gains one refusal, `not-quizmaster`, and the host desk keeps every key. The board shows "Dee asks" in the band where the setlist chip lives. In: block field and builder control, `round.quizmaster`, legality, dispatch role check, phone judge surface, board line, autoplay dwells unchanged. Out: a quizmaster for choice, bluff or minigame blocks; scoring compensation for the reader (they sit out one question per rotation and that is the deal); spoken-answer judging in these blocks.

Judge: fable, because what a phone needs to show a nervous first-time reader, and how little, is a judgment call the spec can only sketch.

## What you'll see
Block 3 opens with "Ada asks". Ada's phone shows the question in large type with the answer below a fold, and three big keys. She reads it out, Bo buzzes, she taps Correct; the board stamps +200 as if the host had. Next question, "Bo asks".

## Verification
`npm test`: legality tests for the player-sourced actions (refused from a non-quizmaster, from a phone in a host-run block, and after the quizmaster disconnects, when the host still can), redaction tests that no other phone receives `whole` or `answer`, rotation tests across a rebound (same reader) and a jump (fresh rotation). `npm run build`; a `walk-quizmaster` probe script that drives the block from the reader's socket.

## Risks and the alternative considered
A quizmaster who leaves mid-question stalls play: the host keys always work, and a disconnect hands the desk back to the host with a board line. Phones are private but a reader can be overlooked; the style guide tells rotating blocks to seat the reader apart, which is a party norm already. The alternative, a second `/host` on a phone, gives one player the whole desk, including scores and kicking, and does not rotate.

## Needs from Rick
