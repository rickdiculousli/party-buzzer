---
id: 018
title: Make npm run typecheck incremental: 21 s to under 2 s on a warm tree
kind: time-cost
size: XS
judge: sonnet
status: building
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
built_by: 9d724f51-ec98-4009-8b1c-4754e564ccce
branch: t3code/8b3f1920
host: k16
---

## Opportunity
Measured on k16 on 2026-10-14 at `6f20bf2` with `node_modules` installed: `npm run typecheck` (`tsc --noEmit`) takes 21.0 s real. Proposal 004 measured 4.8 s on the Mac; k16 is where build threads run. AGENTS.md lists typecheck beside `npm test` and `npm run build` in Validation, so every build and validation thread pays it at least twice per change, and an agent iterating on a type error pays it every loop. With `--incremental --tsBuildInfoFile cache/tsbuildinfo` the first run was 45.8 s (it writes the build info; another process was running) and the second 1.75 s.

## Proposal
Change the `typecheck` script to `tsc --noEmit --incremental --tsBuildInfoFile cache/tsbuildinfo`, add `cache/` to `.gitignore` (the global working rules already name a gitignored `cache/` as the place for task scratch, and this repo has none yet), and note in the AGENTS.md Validation section that the first typecheck in a fresh worktree is slow and later ones are not. In: `package.json`, `.gitignore`, one sentence in `AGENTS.md`. Out: `tsc --build` project references, splitting configs.

Judge: sonnet, because it is one flag, one ignore line and one sentence, with the numbers above as the acceptance test.

## What you'll see
The second and every later `npm run typecheck` in a worktree finishes in about 2 s; a change to one file rechecks in a few seconds. Nothing changes in what is checked.

## Verification
`time npm run typecheck` twice in a fresh worktree after `npm ci`; record both in the commit message. `git status` shows no `cache/` entry after the run. Introduce a deliberate type error and confirm the warm run reports it.

## Risks and the alternative considered
A stale build info file can in theory miss an error; `tsc` invalidates by file hash and version, and the cold run in a fresh worktree is a full check anyway. Alternative: `tsc --watch` in the background; rejected because threads run commands, not daemons.

## Needs from Rick
