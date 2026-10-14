---
id: 023
title: One test that makes every State field declare its undo, disk and phone lifetime
kind: maintenance
size: S
judge: opus
status: proposed
lens: eng
proposed_by: 7f24ed4b-18c6-49f9-a00b-48d7dfed548a
proposed_on: 2026-10-14
---

## Opportunity
AGENTS.md: "Update `server/snapshot.ts` deliberately when adding fields. Decide whether each field belongs in undo, durable state, role projections, or private runtime memory." Three functions each hold that decision as a hand-written list: `gameSnapshot` destructures seven runtime keys out, `persistedSnapshot` names fourteen fields in, and `Hub.viewFor` deletes or rewrites a handful for phones. `State` has 24 top-level fields today and two proposals in this round (014, 013) add more. A new field left out of `persistedSnapshot` is silently dropped at restart; one left in `gameSnapshot` by accident is silently undone. `server/snapshot.test.ts` checks specific fields (`arrival` is excluded from disk, line 156) but nothing checks that every field was classified at all. The ARCHTECTURE.md "Undo versus restart" table is the human copy of the same decision and can drift from both.

## Proposal
`server/lifetimes.test.ts` with a declared table, one row per `State` key: `{ undo: 'yes' | 'no' | 'live', disk: 'yes' | 'no' | 'reset', phone: 'full' | 'own' | 'none' }`. The test builds a `State` with every optional field present (a fixture helper exercises `duel`, `setlist`, `minigame`, `arrival`, `reading`), then asserts: every key of that state has a row and every row names a key (so a new field fails until classified); `gameSnapshot` keeps exactly the `undo: yes` keys; `persistedSnapshot(...).state` has exactly the `disk: yes | reset` keys; `viewFor` for a player omits the `phone: none` keys. In: the new test and fixture. Out: changing any current lifetime; the test documents what is, and a deliberate change edits a row.

Judge: opus, because the rows must be derived from three modules' real behaviour and the optional fields need a fixture that exercises them, which is reading work more than typing work.

## What you'll see
Adding `night` to `State` without touching `snapshot.ts` fails one test with the field's name. The ARCHTECTURE table gets a one-line pointer to the test as its source of truth.

## Verification
`npm test` green; then add a throwaway field to `State` and confirm the test names it; remove it.

## Risks and the alternative considered
A table test can ossify: a row is one line to edit, and that edit is exactly the deliberate decision AGENTS.md asks for. Alternative: TypeScript `satisfies Record<keyof State, ...>` on `persistedSnapshot`'s return; rejected because the disk shape intentionally differs from `State` (reset minigame, filtered effects), and a type cannot say "reset".

## Needs from Rick
