---
id: 001
title: Run the reader tests on a mock clock
kind: test-speed
size: S
judge: opus
status: done
lens: eng
proposed_by: 84f60f14-53e0-4721-b652-b8ea1742ca7e
proposed_on: 2026-10-13
built_by: 84f60f14-53e0-4721-b652-b8ea1742ca7e
branch: t3code/party-buzzer-proposal-round-1
host: k16
merged: bbbec66
---

## Opportunity
`npm test` takes 30.7 s wall for 734 tests in 75 files (measured 2026-10-13, Node 26.7, files run in parallel). One file sets that number: `server/reader.test.ts` alone takes 28.5 s. The next slowest are `server/judge.test.ts` 7.3 s, `tools/rules.test.ts` 6.3 s and `server/integration.test.ts` 5.5 s; all other files are under 4.2 s. Run serially the whole suite is 82 s, so the reader file is a third of all test time and the whole of the wall time.

The reader file has 29 tests and 48 timer waits: 35 are 5 ms polling loops (`while (...) await setTimeout(5)`), the rest fixed waits such as `setTimeout(ARM_DELAY_MS + 40)` and `setTimeout(COLLECT_MS + 30)` (300 ms and 1000 ms from `shared/protocol.ts`), on top of autoplay dwells of 1.5 s and 5 s (`autoplay(hub, 5, 0.3)`). The slowest single tests are 3.2 s ("autoplay presses N itself"), 2.0 s ("Read starts every spent pack over") and 1.9 s ("autoplay pauses before the clue picks up"). `Reader` sleeps through its own `sleep()` on the global `setTimeout` and reads `Date.now()`; `Hub` takes `collectMs` as an option but `ARM_DELAY_MS` is hard-coded in `server/state.ts`.

Every verify run in the definition of done pays this, and so does every build thread's inner loop.

## Proposal
Drive `server/reader.test.ts` with `node:test`'s built-in `mock.timers` (no new dependency): enable `setTimeout`, `setInterval` and `Date` in the `rig()` helper, replace the `while (...) await setTimeout(5)` polling loops with `await mock.timers.tickAsync(ms)` steps, and keep every assertion as it is. Apply the same to `server/judge.test.ts` and `tools/rules.test.ts` if the pattern carries over cleanly. In: the three test files and their rig helpers. Out: a clock abstraction in `Reader` or `Hub`; changing the integration tests, which stay on real timers as the one place real ordering is proven.

Judge: opus, because the result is pinned (same assertions, under 3 s) and only the async ordering under mocked timers is hard.

## What you'll see
`npm test` finishes in about 8 s wall instead of 31 s. `node --test server/reader.test.ts` runs in under 3 s. No test is deleted or weakened.

## Verification
`npm test` green, 734 tests, 0 fail. Time the file before and after with `time node --test server/reader.test.ts` and record both numbers in the commit message. `npm run typecheck` still passes.

## Risks and the alternative considered
Mocked timers can mask real races between the reader's abort signals and the hub's onChange chain. The integration files stay on real timers for that reason, and any reader test that cannot be expressed on a mock clock stays real and is named in the commit. Alternative: inject an `armDelayMs` option beside `collectMs` and shrink the constants in tests; rejected because the autoplay dwells are what the tests are about, and shrinking them still leaves real wall time and 5 ms polling.

## Needs from Rick
