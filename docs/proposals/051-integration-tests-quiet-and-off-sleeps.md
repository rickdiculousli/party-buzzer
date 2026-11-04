---
id: 051
title: The last integration file waits for frames, and closing a test server logs nothing
kind: test-speed
size: S
judge: sonnet
status: proposed
lens: eng
proposed_by: party-buzzer-build-1 operator session
proposed_on: 2026-11-04
from_feedback: party-buzzer-build-1 (party-buzzer-047) #4362 #4363
---

## Opportunity
Spec 047 moved four integration files off fixed sleeps, but
`server/integration.test.ts` still has 21 `sleep(` calls, the same race under
mesh load. And every integration test logs `[state] snapshot failed: ENOENT
... state.json`: a socket closing after `server.close()` queues the debounced
`saveState` (`server/state.ts:587`), which fires after the test removed its
temp dir. It is caught and harmless, but it misled 047's spec into blaming
persistence for a sleep race.

## Proposal
Convert `server/integration.test.ts` to the `FakeClient` waits 047 added
(`until`, `request`, `flush`, `untilOpen` in `server/e2e.ts`), and make the
server's close settle its sockets and flush the pending snapshot before it
resolves, so nothing writes after a test's teardown.
In: the one test file, the close ordering. Out: the snapshot format, other tests.

Judge: sonnet, because the helpers exist and the conversion is mechanical.

## What you'll see
`npm test` prints no `snapshot failed` lines and stays green under load.

## Verification
`npm test` with `grep -c "snapshot failed"` on its output at 0; the 047 loaded
loop (five parallel runs of `node --test server/*integration.test.ts`) green.

## Shown

## Risks and the alternative considered
A flush on close could slow shutdown on a real night by one write; that is
the write the debounce would make anyway. Alternative: silence the log;
rejected because it hides a write into a deleted directory.

## Needs from the operator
