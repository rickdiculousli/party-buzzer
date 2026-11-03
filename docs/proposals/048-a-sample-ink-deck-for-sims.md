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
full game, in the shape `server/minigames/ink/cards.ts` parses), and make the
card loader fall back to it when `packs/phantom-ink.txt` is absent, saying
so once in the server log. The real deck still wins when present.
In: the sample deck, the fallback, the line in `tools/sim-ink.ts`'s header.
Out: the card format, the real deck.

Judge: sonnet, because the format and the fallback are given.

## What you'll see
On a fresh checkout, `npm run sim-ink` plays a game.

## Verification
`npm test` (a `cards.test.ts` case: absent real deck loads the sample,
present real deck wins). `npm run sim-ink` on a disposable room in a fresh
worktree reaches a win.

## Shown

## Risks and the alternative considered
A sample deck could reach a real game night unnoticed; the log line and the
host's deck name say which deck is in play. Alternative: a test-only flag
for sims; rejected because the host benefits from a playable default too.

## Needs from the operator
- Confirm the fallback may reach real game nights (else the sample is sims-only behind an env var).
