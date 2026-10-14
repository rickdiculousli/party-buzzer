---
id: 019
title: Poker table tests stop computing win percentages nobody asserts
kind: test-speed
size: S
judge: sonnet
status: building
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
built_by: b6918ed5-efdf-42ed-af4e-c49ef0d99582
branch: t3code/d7c56aa1
host: k16
---

## Opportunity
Timed serially on k16, 2026-10-14, at `6f20bf2`: `server/minigames/poker/table.test.ts` takes 15.45 s, the slowest file in the suite by nearly three times (next: `server/integration.test.ts` 5.47 s, `poker/equity.test.ts` 5.04 s). Under the parallel `npm test` its single tests read "chips are conserved" 15.3 s, "busts are placed by hand-start stack" 10.8 s, "uncalled bet returns" 8.2 s, "results give places" 7.2 s, "same seed and ordered commands replay identically" 6.7 s. None of them asserts a win percentage. The time goes to `w.equity = equity(hands, w.board, ...)` in `table.ts:278`, which runs on every all-in runout: `EVALUATIONS = 10_000` seven-card `best()` evaluations per preflop runout, for hundreds of hands in the conservation and bust loops. Proposal 001 brought the suite from 31 s to about 8 s wall; this file is now what the wall clock waits on, with `npm test` at 54 s wall on a loaded k16.

## Proposal
Make the sample size a world option: `equity(hands, board, rand, evaluations = EVALUATIONS)` and `PokerWorld.evaluations` set from `create`'s options with the default unchanged; `table.test.ts` creates its worlds with `evaluations: 100`. `equity.test.ts` keeps one seeded full-size test and its 1 % tolerance. In: `equity.ts`, `table.ts`, `table.test.ts`. Out: the shipped sample size, the host options schema (not a host-facing knob), any change to what the tests assert.

Judge: sonnet, because the change is one parameter threaded through two functions and a test fixture.

## What you'll see
`node --test server/minigames/poker/table.test.ts` in about 1 s instead of 15; `npm test` wall time drops by whatever the longest file was holding, around 10 s on a busy k16.

## Verification
Time the file before and after and record both in the commit message; `npm test` green with the same test count; `equity.test.ts` unchanged in result.

## Risks and the alternative considered
A 100-sample equity in tests could mask a bug where equity is read for a decision; the table never reads `w.equity`, it only publishes it for the board. Alternative: compute equity lazily in `boardFrame`; rejected because it moves work onto the 60 Hz pump path.

## Needs from Rick
