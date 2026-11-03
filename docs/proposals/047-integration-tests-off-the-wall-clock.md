---
id: 047
title: Integration tests wait for events, not for fixed sleeps
kind: test-speed
size: S
judge: opus
status: proposed
lens: eng
proposed_by: party-buzzer-build-1 operator session
proposed_on: 2026-11-03
from_feedback: party-buzzer-build-1 (party-buzzer-037, party-buzzer-038) #4202 #4209
---

## Opportunity
Two builds in one evening had `npm test` fail once on a test that passed
alone three times and on rerun: `server/setlist.integration.test.ts` (a
`sleep(60)` step, then ENOENT on its temp `state.json`) and
`server/game-modes.integration.test.ts` "quizbowl wrong: configured neg"
(80 ms sleeps) while k16's load average was 17. The integration tests wait
on wall-clock sleeps: 20 in `setlist`, 15 in `game-modes`, 12 in `duel`, 3 in
`minigame` (`grep -c 'sleep(' server/*.integration.test.ts`). A red verify
under mesh load costs a lead a rerun, and a recorded failure answers repeat
runs from the record until `--rerun`.

## Proposal
Replace each fixed sleep with a wait on the thing the test is about to
assert: a helper `until(socket, predicate, timeoutMs)` that resolves on the
first broadcast satisfying it (and a state-file wait for the persistence
step), shared by the integration files. Keep the server's real timers; where
a test needs a real delay to elapse (the arm delay), wait for the broadcast
that marks it, not the delay plus a margin.
In: the helper, the four files. Out: unit tests already on the mock clock,
production code.

Judge: opus, because each sleep's intent has to be read.

## What you'll see
`npm test` stays green with the box loaded, and the integration files run
no slower.

## Verification
`npm test`; then the four files under load: `for i in 1 2 3 4 5; do node
--test server/*.integration.test.ts & done; wait` passes every run, where
today it fails at least once (record the before run in Shown).

## Shown

## Risks and the alternative considered
A predicate that never matches hangs until its timeout; every wait carries
one and names what it waited for. Alternative: longer sleeps; rejected
because it slows every run and still races under load.

## Needs from the operator
