---
id: 003
title: Make npm test say "run npm ci" in a fresh worktree
kind: time-cost
size: XS
judge: sonnet
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
Every proposal and build thread starts in a fresh T3 worktree under `~/.t3/worktrees/party-buzzer/`, which has no `node_modules`. In this thread the first `npm test` reported 7 failures out of 727: five integration files printed only `'test failed'` with no message, because the Node test runner swallows a file-level import error (`Cannot find package 'ws'`), and two `tools/review.test.ts` tests failed with "expected function" because `@playwright/test` was missing. Tracing that to "dependencies are not installed" took four commands and a direct run of one file. `npm ci --no-audit --no-fund` then took 1.3 s and the suite went green.

The definition of done in AGENTS.md hinges on `npm test` passing, so a thread that misreads this spends its time on a non-bug, or worse, concludes the tests are flaky.

## Proposal
Add a `pretest` script to `package.json` that checks the install and says what to do instead of failing obscurely:

```
"pretest": "test -d node_modules/ws || { echo 'node_modules missing: run npm ci'; exit 1; }"
```

Add a `pretypecheck` with the same guard. Add one sentence to the Validation section of AGENTS.md: "A fresh worktree has no `node_modules`; run `npm ci` first." In: `package.json`, `AGENTS.md`. Out: auto-installing (a verify command should not mutate the checkout), T3 worktree hooks outside this repo.

Judge: sonnet, because it is two lines with an exact spec.

## What you'll see
In a fresh worktree `npm test` stops in under a second with one line naming the fix. With dependencies installed nothing changes.

## Verification
In a disposable worktree: `npm test` prints the message and exits non-zero; after `npm ci`, `npm test` passes with 734 tests.

## Risks and the alternative considered
None of substance; `test -d` is POSIX and zsh-safe. Alternative: `pretest` runs `npm ci` itself. Rejected because verify should not write to the tree, and 1.3 s on every run is still 1.3 s.

## Needs from Rick
