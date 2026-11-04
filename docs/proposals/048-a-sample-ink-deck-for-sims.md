---
id: 048
title: The Ink sim runs on a checked-in sample deck
kind: time-cost
size: S
judge: sonnet
status: proposed
lens: eng
proposed_by: party-buzzer-build-1 operator session
proposed_on: 2026-11-03
from_feedback: party-buzzer-build-1 (party-buzzer-034) #4230
---

## Opportunity
`npm run sim-ink` cannot run on k16: it needs `packs/phantom-ink.txt`,
which is gitignored (`.gitignore:46`) and absent from every checkout, so the
minigame refuses with `ink-cards`. Spec 034's lead had to write a disposable
deck in the test fixture's shape to see its host rows. Every other sim runs
from what the repo ships.

## Proposal
Ship a small original deck, `packs/ink-sample.txt` (enough cards for one
full game, in the shape `server/minigames/ink/cards.ts` parses). The card
loader uses it only when the server runs with `INK_SAMPLE=1` and
`packs/phantom-ink.txt` is absent, and says so once in the server log; a real
game night never falls back to it. `tools/sim-ink.ts`'s header says to start
the server with `INK_SAMPLE=1` on a checkout without the real deck.
In: the sample deck, the env-gated fallback, the sim's header line. Out: the
card format, the real deck, any fallback without the env var.

Judge: sonnet, because the format and the gate are given.

## What you'll see
On a fresh checkout, a server started with `INK_SAMPLE=1` lets `npm run sim-ink`
play a game; without it, the minigame still refuses with `ink-cards`.

## Verification
`npm test` (`cards.test.ts` cases: with the env var and no real deck, the
sample loads; with the real deck, it wins; without the env var, no sample). `npm run sim-ink` against a disposable `INK_SAMPLE=1` server in a fresh
worktree reaches a win.

## Shown

## Risks and the alternative considered
The gate keeps the sample off real nights. Alternative: fall back always;
rejected by the operator, who wants the sample for simulations only.

## Needs from the operator
