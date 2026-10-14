---
id: 015
title: Put the joined-reader tests on the mock clock before they fail a build thread again
kind: test-speed
size: S
judge: opus
status: building
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
built_by: 89aae50a-7558-4ed1-9baf-4b258586eda1
branch: t3code/b498097b
host: k16
---

## Opportunity
`npm test` failed in this thread on 2026-10-14 with the tree clean at `6f20bf2`: `server/reader.joined.test.ts:114` "a clause goes up as it begins, and never crosses into the next fragment" asserted one fragment on the board and found none. The same file passed when run alone, so it is load, not logic. The run was the full suite in parallel on k16 (16 CPUs, 75 files; 54.1 s wall, 1 m 27 s CPU), and the file still uses real timers: `settle = (ms = 30) => setTimeout(r, ms)`, `await settle(400)`, with fold times of 100, 200 and 300 ms from the fake aligner. The same run printed `TimeoutNegativeWarning: -80` from this file, a dwell computed from a clock that had already run past it. Proposal 001 moved `reader.test.ts`, `judge.test.ts` and `rules.test.ts` onto `node:test`'s `mock.timers`; this file was not in scope and is now the slowest unmocked logic file at 4.16 s serial.

The definition of done hinges on `npm test` passing. A flake here costs a build thread a rerun and a reading of the reader, or worse a false "fixed".

## Proposal
Apply 001's recipe to `server/reader.joined.test.ts`: enable `mock.timers` for `setTimeout`, `setInterval` and `Date` in `rig()`, replace `settle(n)` with `await mock.timers.tickAsync(n)`, keep every assertion and the fake speech and aligner as they are. Any test that cannot express its ordering under mocked timers stays real and is named in the commit. In: that one file. Out: `Reader` itself, the integration tests (real timers by design).

Judge: opus, because the assertions are fixed and the only hard part is the same async-ordering work 001 already did once.

## What you'll see
`node --test server/reader.joined.test.ts` runs in under a second instead of 4 s, prints no `TimeoutNegativeWarning`, and passes under a full parallel `npm test` on a busy k16 ten runs out of ten.

## Verification
Record before and after times in the commit message. Run `for i in 1 2 3 4 5 6 7 8 9 10; do npm test >/dev/null || echo FAIL $i; done` once on k16 with nothing else running and once beside a `npm run typecheck`; zero failures.

## Risks and the alternative considered
Mocked timers can hide a real race between the fold timer and the hub's onChange chain; the two joined integration cases in `server/integration.test.ts` keep real timers for that. Alternative: widen `settle(400)` to 1500 ms. Rejected: it slows the file further and only moves the threshold the next busier machine will cross.

## Needs from Rick
