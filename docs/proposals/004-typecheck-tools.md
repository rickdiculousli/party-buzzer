---
id: 004
title: Typecheck tools/ and fix the seven errors it hides
kind: maintenance
size: S
judge: sonnet
status: proposed
lens: eng
proposed_by: 84f60f14-53e0-4721-b652-b8ea1742ca7e
proposed_on: 2026-10-13
---

## Opportunity
`tsconfig.json` includes `server`, `client`, `shared` and `vite.config.ts`. AGENTS.md admits the gap: "The TypeScript project does not explicitly include `tools/`, so typecheck alone does not validate every utility." Adding `tools`, `vite.review.config.ts` and `playwright.review.config.ts` to `include` (measured 2026-10-13) produces 7 errors:

- `tools/probe.ts:180` and `:342` send `setAutoplay` without `buzzSec`. The protocol gained that field; the server clamps a missing value to 10 s, so every `walk-*` script runs with a buzz dwell the script never chose.
- `tools/sim-poker.ts:44,53` and `tools/sim-sketch.ts:37,49,68`: `bots` is an implicit `any[]`.

Typecheck time goes from 4.1 s to 4.8 s with tools included. The `tools/review/*.spec.ts` Playwright files typecheck clean already.

## Proposal
Add the three paths to `include`, fix the seven errors (pass `buzzSec` explicitly in `probe.ts`, type `bots` in the two sims), and delete the AGENTS.md caveat. In: `tsconfig.json`, `tools/probe.ts`, `tools/sim-poker.ts`, `tools/sim-sketch.ts`, `AGENTS.md`. Out: any behaviour change in the tools beyond sending the field they already meant to send.

Judge: sonnet, because the errors are listed and each fix is one line.

## What you'll see
`npm run typecheck` covers every `.ts` in the repo. The next protocol change that breaks a sim or walkthrough fails typecheck instead of a game-night rehearsal.

## Verification
`npm run typecheck` green with 0 errors; `npm test` green; `npm run walk-read-trivia` against a disposable room still completes.

## Risks and the alternative considered
Tools import DOM-free Node modules, and the shared `lib` already lists both DOM and Node types, so no split config is needed; if the Playwright specs ever need their own lib, a `tsconfig.tools.json` extending the root is the fallback. Alternative: leave it and keep the caveat. Rejected because the caveat has already let one real drift through.

## Needs from Rick
