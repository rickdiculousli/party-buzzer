---
id: 002
title: Ship two starter setlists that use the packs we have
kind: feature
size: S
judge: fable
status: building
lens: eng
proposed_by: 84f60f14-53e0-4721-b652-b8ea1742ca7e
proposed_on: 2026-10-13
built_by: 84f60f14-53e0-4721-b652-b8ea1742ca7e
branch: t3code/party-buzzer-proposal-round-1
host: k16
---

## Opportunity
`setlists/` holds one file, `testflow1.json`: five trivia questions at 50 points and one quizbowl question with a vote duel, no packs named, so the host reads it aloud. Meanwhile `packs/` has 41 spoken questions in `game-night.txt` and 10 in `quizbowl-lite.txt`, and five minigames are built. A host who wants a night today builds it block by block in Setup every time.

PRODUCT.md principle 3: "Preserve one continuous game night across the quiz, setlist blocks, and minigames." The roadmap in `docs/superpowers/specs/2026-10-05-game-night-roadmap.md` lists this as project 2, "Starter setlists: a few explained, usable night recipes with sensible defaults and available packs", and notes it can proceed independently of Arrival, which has since landed.

## Proposal
Add two setlists to `setlists/`, each a JSON file in the existing `SetlistBlock` shape (`game`, `options`, `count`, `pack`, `value`, `duel`): a short one of about 20 minutes (trivia from `game-night.txt`, one minigame, a quizbowl finish with a duel) and a full one of about 45 minutes that uses every pack and at least two minigames, with block counts that fit the packs they name. Add a README paragraph under the setlist section naming each and what it plays. Add one pure test in `server/setlists.test.ts` that loads every shipped setlist and checks each block's `game` is in the catalog, its `duel` rule exists, and its `count` does not exceed the named pack's question count. In: setlists, README, that test. Out: new packs, new host UI, introductions between blocks (roadmap project 4), scoring changes.

Judge: fable, because pacing, value curve and which minigame goes where are taste the spec cannot pin.

## What you'll see
Host Setup lists "Quick night" and "Full night" beside `testflow1`. Loading one and pressing Arm plays a whole evening from spoken packs with no further setup. README says what each night contains.

## Verification
`npm test` (the new test fails if a pack shrinks below a block's count). Load each setlist against a running server with `npm run probe -- join:Ada,Bo setlist:...` or the host UI and step through at least the first block of each.

## Risks and the alternative considered
Pack supply is thin: 41 plus 10 spoken questions bound the full night, so the builder may want host-read blocks to fill it; the test keeps counts honest either way. Alternative: a setlist wizard in the host UI; rejected as more UI for the same outcome, and it would still need recipes.

## Needs from Rick
