---
id: 045
title: The fit check finishes on k16 inside the ten-minute limit
kind: time-cost
size: S
judge: opus
status: building
lens: eng
proposed_by: rick
proposed_on: 2026-10-15
built_by: 7d66eea7-ebbc-4be7-b0eb-aa9361d6da62
branch: t3code/01aa5206
host: k16
---

## Opportunity
On k16, `npm run test:review` cannot finish its layout fit check (`tools/review/fits.spec.ts`) inside the 600-second limit a build thread's command gets. During spec 016 the full check timed out, so the thread ran only the closest-guess scenarios and merged on that. Every build since 013–017 added review scenarios, so the run only gets longer, and every UI build hits the same wall and checks a subset or skips the check. The config runs one Playwright worker (`playwright.review.config.ts`, `workers: 1`). The spec loads every scenario × every surface (board and each phone) × 2–3 sizes, each as a fresh page with motion jumped to its end.

## Proposal
Measure first: how long the full `npm run test:review` takes on k16 today, and where the time goes (server start, page loads, the `measure()` pass, the pairwise overlap loop, one big test versus many). Then make the full run finish well inside 600 s on k16, for example 5 minutes or less, with room for the scenarios still to come. Likely levers, chosen by what the measurement shows:
- one Playwright test per scenario, or per scenario and surface, instead of one loop, run on parallel workers sized to the box;
- reuse a page per surface and size, changing only the scenario, instead of a fresh load each time;
- cut wasted waits.

The check must keep its coverage. Every scenario, surface and size it checks today is still checked, and the three rules (no scroll, in bounds, no overlap) are unchanged. In: the review config, `fits.spec.ts` and its helpers, and the AGENTS.md or design-doc lines that say how to run it. Out: changing what counts as a fit failure, dropping sizes or scenarios, and moving the check to CI.

Judge: opus, because the result is pinned (same coverage, under the limit) and the work is measuring and restructuring.

## What you'll see
`npm run test:review` on k16 finishes in well under ten minutes with every scenario covered, and build threads run the full check instead of a subset.

## Verification
`npm test`, plus `npm run test:review` run in full on k16, with the before and after wall times recorded in the closing note. A deliberately broken layout (a temporary overlap) still fails the check, and is reverted.

## Risks and the alternative considered
Parallel workers on an 8-core, 32 GB box that also runs other agents' threads could starve them. Size the worker count to leave headroom, and say what was chosen. Alternative: a longer limit, or sharding the run across several commands. That was rejected: the 600 s cap is the tool's, and a check nobody can run in one go gets skipped.

## Needs from Rick
