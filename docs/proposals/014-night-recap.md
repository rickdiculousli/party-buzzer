---
id: 014
title: Night recap: milestones during play and a keepsake at the finale
kind: feature
size: L
judge: fable
status: done
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
built_by: 34c8999b-16af-44f0-a14d-73d3864dd734
branch: t3code/4e4a1f8a
host: k16
merged: 2c33af0b475449ae5052b96918fcf2604ade7376
---

## Opportunity
The finale is a name and confetti (`Finale` in `client/Board.tsx`, `idle:finale` in `shared/wall.ts`). Everything that made the night is gone by then: `State.round` holds one question, `State.scores` holds totals, and no module remembers who buzzed fastest, who climbed from last to second, or who won Sketch. The roadmap names this twice: project 6 "Meaningful milestones: sparse, factual recognition of a first correct answer or a change at the top of the standings" and project 7 "Night recap: existing finale gains a small factual recap and a locally saved image", and says they "share facts and should settle that contract together". Rick's note for this round asks for "things that would make a party remember the night".

## Proposal
A `night` ledger in `State`: an append-only list of facts the Hub records on applied actions and minigame completions (question verdict with player, points, `deltaMs`, block; standings leader change; minigame results; items fired), part of the undo snapshot so an undone verdict retracts its fact, and durable on disk under `persistedSnapshot` version 2. `shared/recap.ts` derives from it: milestones (first correct of the night, a new leader, a three-in-a-row, a comeback from the bottom half to the podium) and the recap cards (fastest buzz with its margin, longest streak, most lockouts, closest finish, each minigame's winner). Milestones surface as one sparse board line in the stakes corner, never over the hero, at most one per question. At `idle:finale` the board cycles the recap cards after the winner's confetti, and the server writes `nights/<date>.json` and serves `/recap` as a static page the phones open from a small QR in the finale. In: the ledger and its lifetimes, derivation module, board recap cards, `/recap` page, snapshot version bump, a `clearNight` on `clear`. Out: invented awards ("most improved vibe"), photos, anything that requires a remote service, per-player push to phones beyond the QR.

Judge: fable, because which facts are worth saying, and how a recap card reads at 3 m, is taste the spec can list but not settle.

## What you'll see
Mid-night the corner says "New leader: Dee". At the end, after the confetti: "Fastest buzz of the night: Bo, 41 ms ahead", "Comeback: Hal, 8th to 2nd", "Sketch: Ada". A QR in the corner opens the same cards on a phone to keep.

## Verification
`npm test`: pure tests for every derivation on hand-built ledgers (ties, teams grouping keyed by team, manual `setScore` edits excluded from streaks, undo removing a fact, minigame results with `place` only), snapshot tests for version 2 load and a version 1 file loading with an empty ledger. `npm run build`; `npm run sim -- 12` then the finale on the board and `/recap` on a phone.

## Risks and the alternative considered
Facts about people can embarrass: the derivation lists only positive or neutral cards and never "slowest" or "most wrong", and team nights name teams. The ledger grows a few hundred entries a night, trivial for a whole-file snapshot. The alternative, a screenshot of the standings, is what everyone does already and remembers nothing.

## Needs from Rick
